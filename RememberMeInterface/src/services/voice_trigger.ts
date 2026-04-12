// "Who is this?" voice trigger.
//
// PIPELINE.md §4 spec:
//   - continuous SpeechRecognition (webkitSpeechRecognition fallback)
//   - listen for "who is this" | "who's this" | "who is that" substrings
//   - fire callback only if a recognition match happened in the last 10 s
//   - auto-restart on `no-speech` errors
//   - no-op gracefully if the API is unavailable (Firefox, non-Chromium)
//
// Important separation: this stream is NOT used for conversation ingest.
// `conversation_capture.ts` owns the mic/VAD path. The SpeechRecognition
// engine here runs concurrently because it can share the mic device on
// Chromium and is specifically tuned for short command phrases.

// ---------------------------------------------------------------------------
// Ambient types — TypeScript's lib.dom does not ship the SpeechRecognition
// constructor. We declare only the surface we actually use.
// ---------------------------------------------------------------------------

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [idx: number]: {
      readonly isFinal: boolean;
      readonly length: number;
      readonly [altIdx: number]: { readonly transcript: string };
    };
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Substrings that fire the trigger (case-insensitive). */
const TRIGGER_PHRASES: readonly string[] = [
  "who is this",
  "who's this",
  "who is that",
];
/** Rolling window for "recent match" as specified by PIPELINE.md §4 step 3. */
const RECENT_MATCH_WINDOW_MS = 10_000;

let instance: SpeechRecognitionInstance | null = null;
let running = false;
let lastMatchAt: number | null = null;
let onTrigger: (() => void) | null = null;

/**
 * Call whenever the WebSocket delivers a matched recognition result. The
 * caller (App) owns the match state; this module only checks the timestamp.
 */
export function noteRecognitionMatch(): void {
  lastMatchAt = performance.now();
}

/**
 * Begin listening for the trigger phrase. `onWhoIsThis` is invoked only when
 * a phrase is heard AND `noteRecognitionMatch()` was called within the last
 * 10 seconds.
 *
 * If `SpeechRecognition` is unavailable, this is a silent no-op — caller can
 * still use the other features.
 */
export function start(onWhoIsThis: () => void): void {
  onTrigger = onWhoIsThis;
  const Ctor = getCtor();
  if (Ctor === null) return;

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";

  rec.onresult = (ev: SpeechRecognitionEventLike) => {
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const result = ev.results[i];
      if (!result.isFinal) continue;
      if (result.length === 0) continue;
      const transcript = result[0].transcript.toLowerCase();
      if (transcript.length === 0) continue;
      const hit = TRIGGER_PHRASES.some((p) => transcript.includes(p));
      if (!hit) continue;
      if (lastMatchAt === null) continue;
      if (performance.now() - lastMatchAt > RECENT_MATCH_WINDOW_MS) continue;
      onTrigger?.();
    }
  };

  rec.onerror = (ev: SpeechRecognitionErrorEventLike) => {
    // `no-speech` is routine during silence — swallow silently and let
    // `onend` restart the loop.
    if (ev.error !== "no-speech" && ev.error !== "aborted") {
      // Other errors (`not-allowed`, `audio-capture`, `network`) are
      // unrecoverable for this session; stop gracefully.
      running = false;
    }
  };

  rec.onend = () => {
    // continuous:true browsers will still emit `end` after long silences
    // or on `no-speech`. Restart immediately unless explicitly stopped.
    if (!running) return;
    try {
      rec.start();
    } catch {
      // Restart racing against a pending stop — ignore.
    }
  };

  instance = rec;
  running = true;
  try {
    rec.start();
  } catch {
    running = false;
    instance = null;
  }
}

/** Stop listening. Idempotent. */
export function stop(): void {
  running = false;
  if (instance !== null) {
    try {
      instance.abort();
    } catch {
      // Ignore.
    }
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    instance = null;
  }
  onTrigger = null;
}

/** True if the API is available and we're actively listening. */
export function isAvailable(): boolean {
  return getCtor() !== null;
}
