// Conversation capture → transcribe → submit pipeline.
//
// Transcription uses a single continuous SpeechRecognition session that runs
// alongside the VAD. This same recognizer also detects "who is this?" trigger
// phrases — Safari only allows ONE active SpeechRecognition at a time, so
// voice_trigger.ts no longer runs its own.
//
// VAD thresholds are tuned so speech-end fires reliably even with ambient
// noise (negativeSpeechThreshold raised, redemptionFrames lowered).

import { MicVAD } from "@ricky0123/vad-web";

import { postConversation } from "./rest_client";
import type { Id } from "../types/api";

/** CLAUDE.md §5 — minimum segment length. */
const MIN_SEGMENT_SECONDS = 5.0;
/** PIPELINE.md §2.1 step 7. */
const MIN_TRANSCRIPT_CHARS = 10;
/** WAV sample rate matches MicVAD's model input rate. */
const SAMPLE_RATE_HZ = 16_000;

/** Trigger phrases for "who is this?" detection (case-insensitive). */
const TRIGGER_PHRASES: readonly string[] = [
  "who is this",
  "who's this",
  "who is that",
];

export interface StartOptions {
  getRecentFaceIds: () => Id[];
  onSegmentSubmitted?: (transcriptId: Id) => void;
  onSegmentDiscarded?: (reason: string) => void;
  /** Called when a "who is this?" trigger phrase is detected. */
  onTriggerPhrase?: () => void;
}

let vad: MicVAD | null = null;
let patientIdState: Id | null = null;
let currentOptions: StartOptions | null = null;

// ---------------------------------------------------------------------------
// Continuous browser SpeechRecognition — runs in parallel with the VAD.
// Also handles "who is this?" trigger detection (replaces voice_trigger.ts).
// ---------------------------------------------------------------------------

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: {
          length: number;
          [idx: number]: {
            isFinal: boolean;
            length: number;
            [i: number]: { transcript: string };
          };
        };
      }) => void)
    | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

let recognizer: SpeechRecognitionLike | null = null;
let recognizerRunning = false;
/** Accumulated final transcripts since last drain. */
let transcriptBuffer: string[] = [];

function drainTranscriptBuffer(): string {
  const text = transcriptBuffer.join(" ").trim();
  transcriptBuffer = [];
  return text;
}

function startRecognizer(): void {
  const Ctor = getSpeechRecognitionCtor();
  if (Ctor === null) return;

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";

  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const result = ev.results[i];
      if (!result.isFinal || result.length === 0) continue;
      const text = result[0].transcript.trim();
      if (text.length === 0) continue;

      transcriptBuffer.push(text);

      // Check for "who is this?" trigger phrases.
      const lower = text.toLowerCase();
      const hit = TRIGGER_PHRASES.some((p) => lower.includes(p));
      if (hit) {
        console.log("[conversation_capture] Trigger phrase detected:", text);
        currentOptions?.onTriggerPhrase?.();
      }
    }
  };

  rec.onerror = (ev) => {
    if (ev.error !== "no-speech" && ev.error !== "aborted") {
      recognizerRunning = false;
    }
  };

  rec.onend = () => {
    if (!recognizerRunning) return;
    try {
      rec.start();
    } catch {
      // Race between stop and restart — ignore.
    }
  };

  recognizer = rec;
  recognizerRunning = true;
  try {
    rec.start();
  } catch {
    recognizerRunning = false;
    recognizer = null;
  }
}

function stopRecognizer(): void {
  recognizerRunning = false;
  if (recognizer !== null) {
    try {
      recognizer.abort();
    } catch {
      // Ignore.
    }
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    recognizer = null;
  }
  transcriptBuffer = [];
}

// ---------------------------------------------------------------------------
// VAD speech-end handler
// ---------------------------------------------------------------------------

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

  const endedAt = Date.now();
  const startedAtIso = new Date(
    endedAt - Math.round(segmentDurationSeconds * 1000),
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  const transcript = drainTranscriptBuffer();

  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    opts.onSegmentDiscarded?.("empty_transcript");
    return;
  }

  console.log("[conversation_capture] Submitting transcript:", transcript.slice(0, 80));

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
    opts.onSegmentDiscarded?.("submit_failed");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function start(
  patientId: Id,
  options: StartOptions,
): Promise<void> {
  if (vad !== null) return;
  patientIdState = patientId;
  currentOptions = options;

  // Start the continuous recognizer BEFORE the VAD so it's already
  // accumulating transcripts when the first speech segment fires.
  startRecognizer();

  vad = await MicVAD.new({
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/",
    // Raise negativeSpeechThreshold so the VAD is quicker to decide
    // "this is no longer speech" even with ambient noise. Lower
    // redemptionFrames so fewer consecutive non-speech frames are needed
    // before firing onSpeechEnd.
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.5,
    redemptionMs: 300,
    onSpeechEnd: (audio: Float32Array) => {
      void handleSpeechEnd(audio, options);
    },
  });
  await vad.start();
}

export async function stop(): Promise<void> {
  stopRecognizer();
  if (vad === null) return;
  try {
    await vad.destroy();
  } catch {
    // Ignore shutdown errors.
  }
  vad = null;
  patientIdState = null;
  currentOptions = null;
}

export function isRunning(): boolean {
  return vad !== null;
}
