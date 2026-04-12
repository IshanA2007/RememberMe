// Singleton audio player with cancel-on-new semantics.
//
// Hard constraint from DESIGN_DOC.md §9.2 / FRONTEND_SPEC.md §1.4: at most
// ONE audio cue plays at a time. A new `play(blob)` call always replaces the
// current cue — there is no queue, no fade — per CLAUDE.md §4.
//
// We hold a single `HTMLAudioElement` module-wide. `URL.createObjectURL` is
// revoked on every replacement to avoid leaking blob handles during long
// sessions.

type Listener = (isPlaying: boolean) => void;

let audioEl: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let isPlayingState = false;
const listeners = new Set<Listener>();

function ensureElement(): HTMLAudioElement {
  if (audioEl !== null) return audioEl;
  const el = new Audio();
  el.preload = "auto";
  el.addEventListener("ended", () => setPlaying(false));
  el.addEventListener("pause", () => {
    // `pause` fires on cancel-on-new; keep state truthful.
    if (el.ended || el.currentTime === 0) setPlaying(false);
  });
  el.addEventListener("error", () => setPlaying(false));
  audioEl = el;
  return el;
}

function setPlaying(next: boolean): void {
  if (next === isPlayingState) return;
  isPlayingState = next;
  for (const cb of listeners) cb(next);
}

function revokeCurrentUrl(): void {
  if (currentUrl !== null) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/**
 * Play the given blob. Cancels any prior cue first — this is the rule that
 * keeps Vision to one audio stream. Returns when `.play()` has been called;
 * the actual `ended` event is delivered to subscribers.
 */
export async function play(blob: Blob): Promise<void> {
  const el = ensureElement();
  // Cancel prior: pause, detach source, revoke URL.
  try {
    el.pause();
  } catch {
    // Pause on an already-paused element is fine.
  }
  revokeCurrentUrl();

  const url = URL.createObjectURL(blob);
  currentUrl = url;
  el.src = url;
  el.load();
  try {
    await el.play();
    setPlaying(true);
  } catch {
    // Autoplay rejection or navigation — treat as not playing so the
    // speaking-layer UI collapses.
    setPlaying(false);
  }
}

/** Explicit stop (e.g. on unmount). Fires `isPlaying=false`. */
export function stop(): void {
  if (audioEl !== null) {
    try {
      audioEl.pause();
    } catch {
      // Ignore.
    }
    audioEl.currentTime = 0;
  }
  revokeCurrentUrl();
  setPlaying(false);
}

/** Current play state — prefer `subscribe` for reactive UI. */
export function isPlaying(): boolean {
  return isPlayingState;
}

/**
 * Subscribe to play-state changes. The callback receives the new state
 * synchronously on transition. Not fired at subscription time — call
 * `isPlaying()` for the initial value.
 */
export function subscribe(cb: Listener): void {
  listeners.add(cb);
}

export function unsubscribe(cb: Listener): void {
  listeners.delete(cb);
}
