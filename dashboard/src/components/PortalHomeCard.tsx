/**
 * PortalHomeCard — two-zone portal picker for `/` (FRONTEND_SPEC §2.5,
 * frontend.mdc §6.4).
 *
 * NOT twin buttons: each zone is its own designed moment — editorial intro
 * in Fraunces 20px, CTA in Fraunces 56px display. A single hairline rule
 * (1px --rule) separates them. No card shadow, no rounded-2xl.
 *
 * The zones stack vertically on narrow viewports (separator becomes
 * horizontal) and sit side-by-side with a vertical rule on wider screens.
 */

import type { ReactElement } from 'react';

export interface PortalHomeCardProps {
  onPatientClick: () => void;
  onCaretakerClick: () => void;
}

interface ZoneProps {
  overline: string;
  cta: string;
  onClick: () => void;
  /** Aligns text to left/right to create an asymmetric, authored feel. */
  align: 'left' | 'right';
}

function Zone({ overline, cta, onClick, align }: ZoneProps): ReactElement {
  const alignClass = align === 'left' ? 'items-start text-left' : 'items-end text-right';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col justify-center gap-6 p-12 transition-colors ${alignClass}`}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        minHeight: 360,
        color: 'var(--ink-primary)',
      }}
    >
      <span
        className="font-display text-ink-secondary"
        style={{
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: '-0.01em',
          maxWidth: 360,
          lineHeight: 1.25,
        }}
      >
        {overline}
      </span>
      <span
        className="font-display"
        style={{
          fontSize: 56,
          fontWeight: 600,
          letterSpacing: '-0.03em',
          lineHeight: 0.98,
        }}
      >
        {cta}
      </span>
    </button>
  );
}

export function PortalHomeCard({
  onPatientClick,
  onCaretakerClick,
}: PortalHomeCardProps): ReactElement {
  return (
    <div
      className="grid w-full"
      style={{
        // On wide viewports: two columns divided by a 1px vertical rule.
        // On narrow viewports: media query in inline CSS below.
        gridTemplateColumns: 'minmax(0, 1fr) 1px minmax(0, 1fr)',
      }}
    >
      <Zone
        overline="For patients"
        cta="Patient Portal"
        onClick={onPatientClick}
        align="left"
      />
      <div
        aria-hidden
        style={{
          backgroundColor: 'var(--rule)',
          width: 1,
          alignSelf: 'stretch',
          justifySelf: 'center',
        }}
      />
      <Zone
        overline="For caretakers and family"
        cta="Caregiver Portal"
        onClick={onCaretakerClick}
        align="right"
      />
    </div>
  );
}
