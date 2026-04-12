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
}

function firstLine(text: string | null | undefined): string {
  if (!text) return '';
  const t = text.trim();
  const nl = t.indexOf('\n');
  return nl === -1 ? t : t.slice(0, nl);
}

export function FaceCard({ face, onClick }: FaceCardProps): ReactElement {
  const content = (
    <>
      <div
        className="font-display text-ink-primary"
        style={{
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {face.name}
      </div>
      {face.title ? (
        <div
          className="font-text text-ink-secondary"
          style={{ fontSize: 14, marginTop: 4, lineHeight: 1.4 }}
        >
          {face.title}
        </div>
      ) : null}
      {face.description ? (
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
    padding: '14px 16px',
    borderRadius: 2,
    minWidth: 180,
    maxWidth: 220,
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
