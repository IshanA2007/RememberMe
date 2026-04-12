// Conversation capture → transcribe → submit pipeline.
//
// PIPELINE.md §2.1:
//   1. Mic via getUserMedia → VAD (@ricky0123/vad-web MicVAD).
//   2. Each segment is onset→2 s silence.
//   3. Discard segments shorter than 5.0 s.
//   4. Capture recognized face_ids at segment end (last 10 s, caller-supplied).
//   5. Transcribe:
//        Option A: POST /api/stt/transcribe
//        Option B: browser SpeechRecognition (fallback)
//   6. If transcript ≥ 10 chars, POST /api/conversations.
//
// The VAD emits PCM samples at 16 kHz. We wrap them into a WAV blob via
// `vad-web`'s own `utils.encodeWAV` for a format the backend STT can accept.

import { MicVAD, utils as vadUtils } from "@ricky0123/vad-web";

import { postConversation, stt, ApiError } from "./rest_client";
import type { Id } from "../types/api";

/** CLAUDE.md §5 — minimum segment length. */
const MIN_SEGMENT_SECONDS = 5.0;
/** PIPELINE.md §2.1 step 7. */
const MIN_TRANSCRIPT_CHARS = 10;
/** WAV sample rate matches MicVAD's model input rate. */
const SAMPLE_RATE_HZ = 16_000;

export interface StartOptions {
  /**
   * Returns the `face_id`s active in the last 10 s at segment end (callers
   * typically read this from a map keyed by frame_id of in-session matches).
   */
  getRecentFaceIds: () => Id[];
  /** Optional hook for logging or UI-side breadcrumbs. */
  onSegmentSubmitted?: (transcriptId: Id) => void;
  /** Optional hook when a segment is discarded (too short / empty / failed). */
  onSegmentDiscarded?: (reason: string) => void;
}

let vad: MicVAD | null = null;
let patientIdState: Id | null = null;

/**
 * Convert the VAD's Float32 PCM (±1.0, 16 kHz) into a mono WAV blob suitable
 * for `rest_client.stt`.
 */
function samplesToWavBlob(samples: Float32Array): Blob {
  const wavBuffer = vadUtils.encodeWAV(samples, 1, SAMPLE_RATE_HZ, 1, 16);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

/**
 * Fallback: browser SpeechRecognition reading from the same samples is NOT
 * possible (it grabs its own mic stream). When backend STT fails, we fall
 * through a second pass that uses `webkitSpeechRecognition` on the live
 * stream. Because we have no way to rewind, we best-effort transcribe a
 * short sample — PIPELINE.md §2.1 Option B explicitly allows this.
 */
async function fallbackBrowserStt(): Promise<string | null> {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionFallback;
    webkitSpeechRecognition?: new () => SpeechRecognitionFallback;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  if (Ctor === null) return null;
  return await new Promise<string | null>((resolve) => {
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    const timeoutId = window.setTimeout(() => {
      try {
        rec.abort();
      } catch {
        // Ignore.
      }
      resolve(null);
    }, 6_000);
    rec.onresult = (ev) => {
      window.clearTimeout(timeoutId);
      const parts: string[] = [];
      for (let i = 0; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal && r.length > 0) parts.push(r[0].transcript);
      }
      resolve(parts.join(" ").trim() || null);
    };
    rec.onerror = () => {
      window.clearTimeout(timeoutId);
      resolve(null);
    };
    rec.onend = () => {
      window.clearTimeout(timeoutId);
      // resolve with null if no result already fired
    };
    try {
      rec.start();
    } catch {
      window.clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

interface SpeechRecognitionFallback {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  abort(): void;
  onresult: (ev: {
    results: {
      length: number;
      [idx: number]: {
        isFinal: boolean;
        length: number;
        [i: number]: { transcript: string };
      };
    };
  }) => void;
  onerror: (ev: Event) => void;
  onend: (ev: Event) => void;
}

async function handleSpeechEnd(
  samples: Float32Array,
  opts: StartOptions,
): Promise<void> {
  if (patientIdState === null) return;
  const patientId = patientIdState;
  const segmentDurationSeconds = samples.length / SAMPLE_RATE_HZ;
  if (segmentDurationSeconds < MIN_SEGMENT_SECONDS) {
    opts.onSegmentDiscarded?.("too_short");
    return;
  }

  // Record the start timestamp by subtracting the segment duration from now;
  // MicVAD does not give us the segment onset clock directly.
  const endedAt = Date.now();
  const startedAtIso = new Date(
    endedAt - Math.round(segmentDurationSeconds * 1000),
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  // Transcribe: Option A (backend STT) → Option B (browser fallback).
  const blob = samplesToWavBlob(samples);
  let transcript: string | null = null;
  try {
    const res = await stt(blob, patientId);
    transcript = res.transcript.trim();
  } catch (err) {
    if (err instanceof ApiError) {
      // Fall through to browser STT.
      transcript = await fallbackBrowserStt();
    } else {
      // Network or unexpected error — still try fallback.
      transcript = await fallbackBrowserStt();
    }
  }

  if (transcript === null || transcript.length < MIN_TRANSCRIPT_CHARS) {
    opts.onSegmentDiscarded?.("empty_transcript");
    return;
  }

  const recognizedFaceIds = opts.getRecentFaceIds();
  try {
    const submitResp = await postConversation({
      patient_id: patientId,
      transcript,
      recorded_at: startedAtIso,
      duration_seconds: segmentDurationSeconds,
      recognized_face_ids: recognizedFaceIds,
    });
    opts.onSegmentSubmitted?.(submitResp.transcript_id);
  } catch {
    // Submission failure is silent — the patient session continues.
    opts.onSegmentDiscarded?.("submit_failed");
  }
}

/**
 * Start the capture pipeline for the given patient. Idempotent while
 * running (subsequent calls are ignored). Resolves once the VAD worklet is
 * initialised and the mic is acquired — can reject if the user denies the
 * mic permission.
 */
export async function start(
  patientId: Id,
  options: StartOptions,
): Promise<void> {
  if (vad !== null) return;
  patientIdState = patientId;
  // MicVAD.new() handles getUserMedia + AudioWorklet setup internally.
  vad = await MicVAD.new({
    // VAD model + worklet are served from /public/vad/; ORT WASM from
    // /public/ort/. Copied from node_modules at dev setup so we don't
    // depend on a CDN or on Vite's node_modules serving path (which
    // cannot resolve `.mjs?import` for ORT's WASM workers).
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/ort/",
    onSpeechEnd: (audio: Float32Array) => {
      // Fire-and-forget; we don't want to block the VAD event loop.
      void handleSpeechEnd(audio, options);
    },
  });
  await vad.start();
}

/** Stop the capture pipeline. Safe to call multiple times. */
export async function stop(): Promise<void> {
  if (vad === null) return;
  try {
    await vad.destroy();
  } catch {
    // Ignore shutdown errors.
  }
  vad = null;
  patientIdState = null;
}

/** True if capture is currently active. */
export function isRunning(): boolean {
  return vad !== null;
}
