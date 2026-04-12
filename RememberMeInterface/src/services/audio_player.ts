// Singleton audio player using Web Audio API with cancel-on-new semantics.
//
// Hard constraint from DESIGN_DOC.md §9.2 / FRONTEND_SPEC.md §1.4: at most
// ONE audio cue plays at a time. A new `play(blob)` call always replaces the
// current cue — there is no queue, no fade — per CLAUDE.md §4.
//
// Uses AudioContext instead of HTMLAudioElement because Safari blocks
// HTMLAudioElement.play() unless called directly from a user gesture.
// An AudioContext only needs to be resume()'d once from a gesture, after
// which all decodeAudioData + sourceNode.start() calls work freely.

type Listener = (isPlaying: boolean) => void;

let ctx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isPlayingState = false;
const listeners = new Set<Listener>();

function ensureContext(): AudioContext {
  if (ctx !== null) return ctx;
  ctx = new AudioContext();
  return ctx;
}

function setPlaying(next: boolean): void {
  if (next === isPlayingState) return;
  isPlayingState = next;
  for (const cb of listeners) cb(next);
}

/**
 * Unlock the AudioContext. Call this from a user-gesture handler (click/tap)
 * early in the app lifecycle. After this, all programmatic play() calls work
 * without further gestures — even from SpeechRecognition callbacks.
 */
export function unlock(): void {
  const c = ensureContext();
  if (c.state === "suspended") {
    void c.resume();
  }
}

/**
 * Play the given audio blob. Cancels any prior cue first.
 */
export async function play(blob: Blob): Promise<void> {
  const c = ensureContext();
  // Resume just in case — no-op if already running.
  if (c.state === "suspended") {
    await c.resume();
  }

  // Cancel prior source.
  if (currentSource !== null) {
    try {
      currentSource.onended = null;
      currentSource.stop();
    } catch {
      // Already stopped.
    }
    currentSource = null;
    setPlaying(false);
  }

  const arrayBuf = await blob.arrayBuffer();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await c.decodeAudioData(arrayBuf);
  } catch (err) {
    console.error("[audio_player] decodeAudioData failed:", err);
    setPlaying(false);
    return;
  }

  const source = c.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(c.destination);
  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
      setPlaying(false);
    }
  };
  currentSource = source;
  source.start();
  setPlaying(true);
}

/** Explicit stop (e.g. on unmount). Fires `isPlaying=false`. */
export function stop(): void {
  if (currentSource !== null) {
    try {
      currentSource.onended = null;
      currentSource.stop();
    } catch {
      // Already stopped.
    }
    currentSource = null;
  }
  setPlaying(false);
}

/** Current play state — prefer `subscribe` for reactive UI. */
export function isPlaying(): boolean {
  return isPlayingState;
}

export function subscribe(cb: Listener): void {
  listeners.add(cb);
}

export function unsubscribe(cb: Listener): void {
  listeners.delete(cb);
}
