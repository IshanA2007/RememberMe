// AudioIndicator — tiny wave icon that fades in while TTS audio is playing.
//
// FRONTEND_SPEC §1.2 adds "speaking" as an additive layer; this is the only
// UI element it contributes. Subscribes directly to `audio_player.ts` so the
// App does not have to thread state.
//
// Motion: opacity transitions only (0 → 0.7 → 0). No pulsing (frontend.mdc §4.5).

import { useEffect, useState } from "react";

import {
  isPlaying as audioIsPlaying,
  subscribe,
  unsubscribe,
} from "../services/audio_player";

export function AudioIndicator(): JSX.Element {
  const [playing, setPlaying] = useState<boolean>(audioIsPlaying());

  useEffect(() => {
    const cb = (next: boolean): void => {
      setPlaying(next);
    };
    subscribe(cb);
    // Pick up any state change that occurred between render and subscription.
    setPlaying(audioIsPlaying());
    return () => {
      unsubscribe(cb);
    };
  }, []);

  return (
    <div
      className="fixed pointer-events-none"
      role="img"
      aria-label={playing ? "Speaking" : "Silent"}
      aria-hidden={playing ? undefined : true}
      style={{
        left: "24px",
        bottom: "24px",
        width: "28px",
        height: "28px",
        opacity: playing ? 0.7 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      <svg
        viewBox="0 0 28 28"
        width="28"
        height="28"
        fill="none"
        stroke="var(--ink-secondary)"
        strokeWidth={1}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="8" y1="10" x2="8" y2="18" />
        <line x1="14" y1="6" x2="14" y2="22" />
        <line x1="20" y1="10" x2="20" y2="18" />
      </svg>
    </div>
  );
}

export default AudioIndicator;
