// IdentityCard — overlay shown above a recognized face bbox.
//
// FRONTEND_SPEC §1.3 "Identity card":
//   - Large name ≥32 px, title ≥24 px, memory summary ≥20 px (2-line clamp).
//   - Sits immediately above the face bbox; 3 s lifetime is owned by the App
//     (via `expiresAt` in its state map).
//
// Motion (frontend.mdc §4.4):
//   - Enters with a 200 ms scale(0.95)→scale(1) + opacity 0→1 transition.
//   - No bounce. No infinite animation. Respects `prefers-reduced-motion`
//     (global rule in styles/index.css zeroes animations + transitions).

import { useEffect, useState } from "react";

import type { BBox } from "../types/api";

export interface IdentityCardProps {
  name: string;
  title: string | null;
  memorySummary: string;
  /** Bbox in viewport (CSS) coordinates. Top-left origin. */
  bbox: BBox;
  /**
   * The video element's bounding rect at the time the bbox was reported.
   * Used only to clamp the card inside the viewport; the bbox itself is
   * already viewport-space from VideoCanvas.
   */
  videoRect: DOMRect;
  onDismiss?: () => void;
}

const CARD_WIDTH = 360;
const CARD_GAP = 8;

export function IdentityCard(props: IdentityCardProps): JSX.Element {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // Next tick so the initial render applies "from" styles before we toggle.
    const id = window.setTimeout(() => {
      setEntered(true);
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, []);

  // Card position: horizontally centered over the bbox; vertically just above.
  // Card height is dynamic so we use bottom=rest-of-viewport for y-anchoring.
  const { bbox, videoRect } = props;
  const rawLeft = bbox.x + bbox.w / 2 - CARD_WIDTH / 2;
  const minLeft = videoRect.left + 8;
  const maxLeft = videoRect.right - CARD_WIDTH - 8;
  const left = Math.max(minLeft, Math.min(maxLeft, rawLeft));
  const bottom = Math.max(
    8,
    window.innerHeight - (bbox.y - CARD_GAP),
  );

  // Hidden aria-live text mirror for screen readers (FRONTEND_SPEC §3.4).
  const mirror =
    props.title !== null && props.title.length > 0
      ? `${props.name}, ${props.title}. ${props.memorySummary}`
      : `${props.name}. ${props.memorySummary}`;

  return (
    <div
      className="fixed"
      style={{
        left: `${left.toString()}px`,
        bottom: `${bottom.toString()}px`,
        width: `${CARD_WIDTH.toString()}px`,
        background: "var(--bg-elevated)",
        border: "1px solid var(--rule)",
        borderRadius: "2px",
        padding: "16px 20px",
        transform: entered ? "scale(1)" : "scale(0.95)",
        opacity: entered ? 1 : 0,
        transition: "transform 200ms ease-out, opacity 200ms ease-out",
        pointerEvents: props.onDismiss !== undefined ? "auto" : "none",
      }}
      onClick={props.onDismiss}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "40px",
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          color: "var(--ink-primary)",
        }}
      >
        {props.name}
      </div>
      {props.title !== null && props.title.length > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-text)",
            fontSize: "24px",
            fontWeight: 400,
            lineHeight: 1.3,
            color: "var(--ink-secondary)",
            marginTop: "6px",
          }}
        >
          {props.title}
        </div>
      ) : null}
      {props.memorySummary.length > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-text)",
            fontSize: "20px",
            lineHeight: 1.5,
            color: "var(--ink-primary)",
            marginTop: "10px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {props.memorySummary}
        </div>
      ) : null}
      <span
        aria-live="polite"
        className="sr-only"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {mirror}
      </span>
    </div>
  );
}

export default IdentityCard;
