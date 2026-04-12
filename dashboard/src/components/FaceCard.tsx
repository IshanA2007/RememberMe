/**
 * FaceCard — tight identity card for a single face.
 *
 * Used both inside MemoryTree (as the leaf nodes) and potentially on a
 * face-list view. No drop shadow; a 1px --rule border and an inset fill
 * on --bg-elevated carry the "card" silhouette per frontend.mdc §5.3.
 *
 * Typography (plan D2.6 / §9 + FaceCard spec):
 *   - Name:        Fraunces 24px, --ink-primary
 *   - Title:       Newsreader 14px, --ink-secondary
 *   - Description: Newsreader 14px, first line only
 */

import type { ReactElement } from 'react';
import type { FaceObject } from '../types/api';

export interface FaceCardProps {
  face: FaceObject;
  onClick?: () => void;
  /** When true, shrinks typography for tight tree layouts. */
  compact?: boolean;
}

function firstLine(text: string | null | undefined): string {
  if (!text) return '';
  const t = text.trim();
  const nl = t.indexOf('\n');
  return nl === -1 ? t : t.slice(0, nl);
}

export function FaceCard({ face, onClick, compact }: FaceCardProps): ReactElement {
  const nameFontSize = compact ? 16 : 24;
  const subFontSize = compact ? 12 : 14;
  const pad = compact ? '8px 10px' : '14px 16px';

  const content = (
    <>
      <div
        className="font-display text-ink-primary"
        style={{
          fontSize: nameFontSize,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {face.name}
      </div>
      {face.title ? (
        <div
          className="font-text text-ink-secondary"
          style={{
            fontSize: subFontSize,
            marginTop: compact ? 2 : 4,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {face.title}
        </div>
      ) : null}
      {!compact && face.description ? (
        <div
          className="font-text text-ink-secondary"
          style={{
            fontSize: 14,
            marginTop: 8,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {firstLine(face.description)}
        </div>
      ) : null}
    </>
  );

  const surfaceStyle = {
    border: '1px solid var(--rule)',
    backgroundColor: 'var(--bg-elevated)',
    padding: pad,
    borderRadius: 2,
    minWidth: 0,
    maxWidth: '100%',
    width: '100%',
    textAlign: 'left' as const,
    color: 'var(--ink-primary)',
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col"
        style={{ ...surfaceStyle, cursor: 'pointer' }}
        aria-label={`Open ${face.name}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-col" style={surfaceStyle}>
      {content}
    </div>
  );
}
