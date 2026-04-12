// ReminderCard — bottom-right card fired at T-5min (PIPELINE §3.3).
//
// FRONTEND_SPEC §1.3 "Reminder card":
//   - 320 px wide, anchored bottom-right, 24 px padding.
//   - Title Fraunces 28 px bold; description Newsreader 20 px.
//   - Fade-in 200 ms → visible 15 s → fade-out 200 ms → unmount.
//   - Only one at a time — the App keeps a singleton slot (frontend.mdc §6.1).
//
// Motion: CSS transition only; no infinite loops. `aria-live="assertive"`
// on the title so screen readers announce the reminder promptly.

import { useEffect, useState } from "react";

export interface ReminderCardProps {
  title: string;
  description?: string | null;
  onDismiss?: () => void;
}

const VISIBLE_DURATION_MS = 15_000;
const FADE_MS = 200;

export function ReminderCard(props: ReminderCardProps): JSX.Element {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

  useEffect(() => {
    const enterTimer = window.setTimeout(() => {
      setPhase("visible");
    }, FADE_MS);
    const exitTimer = window.setTimeout(() => {
      setPhase("exit");
    }, FADE_MS + VISIBLE_DURATION_MS);
    const doneTimer = window.setTimeout(() => {
      props.onDismiss?.();
    }, FADE_MS + VISIBLE_DURATION_MS + FADE_MS);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
    // Intentionally run once per mount; props.onDismiss is stable enough
    // for the App singleton usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opacity = phase === "enter" ? 0 : phase === "visible" ? 1 : 0;

  return (
    <div
      className="fixed"
      style={{
        right: "24px",
        bottom: "24px",
        width: "320px",
        padding: "24px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--signal-cool)",
        borderRadius: "2px",
        opacity,
        transition: `opacity ${FADE_MS.toString()}ms ease-out`,
      }}
      role="status"
    >
      <div
        aria-live="assertive"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "28px",
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: "var(--ink-primary)",
        }}
      >
        {props.title}
      </div>
      {props.description !== undefined &&
      props.description !== null &&
      props.description.length > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-text)",
            fontSize: "20px",
            lineHeight: 1.5,
            color: "var(--ink-secondary)",
            marginTop: "10px",
          }}
        >
          {props.description}
        </div>
      ) : null}
    </div>
  );
}

export default ReminderCard;
