// UnknownBadge — small `?` glyph rendered over an unknown face's bbox.
//
// FRONTEND_SPEC §1.3: "Unknown badge — small `?` icon in the top-right of
// the bbox. No prompting in-stream; caretaker handles via Dashboard."
//
// 24 x 24 square, --signal-warm fill, Fraunces 16 px bold `?` in --bg-base,
// 200 ms fade-in. Static — no pulse, no spin (forbidden patterns, CLAUDE.md §4).

import { useEffect, useState } from "react";

import type { BBox } from "../types/api";

export interface UnknownBadgeProps {
  bbox: BBox;
  /** For clamp-to-video logic. Badge is anchored in viewport space. */
  videoRect: DOMRect;
}

const BADGE_SIZE = 24;

export function UnknownBadge(props: UnknownBadgeProps): JSX.Element {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setEntered(true);
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, []);

  const { bbox, videoRect } = props;
  // Anchor at the top-right corner of the bbox, slightly inset inside the box.
  const rawLeft = bbox.x + bbox.w - BADGE_SIZE - 4;
  const rawTop = bbox.y + 4;
  const minLeft = videoRect.left + 4;
  const maxLeft = videoRect.right - BADGE_SIZE - 4;
  const minTop = videoRect.top + 4;
  const maxTop = videoRect.bottom - BADGE_SIZE - 4;
  const left = Math.max(minLeft, Math.min(maxLeft, rawLeft));
  const top = Math.max(minTop, Math.min(maxTop, rawTop));

  return (
    <div
      className="fixed pointer-events-none flex items-center justify-center"
      role="img"
      aria-label="Unknown person"
      style={{
        left: `${left.toString()}px`,
        top: `${top.toString()}px`,
        width: `${BADGE_SIZE.toString()}px`,
        height: `${BADGE_SIZE.toString()}px`,
        background: "var(--signal-warm)",
        color: "var(--bg-base)",
        fontFamily: "var(--font-display)",
        fontSize: "16px",
        fontWeight: 700,
        lineHeight: 1,
        borderRadius: "2px",
        opacity: entered ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      ?
    </div>
  );
}

export default UnknownBadge;
