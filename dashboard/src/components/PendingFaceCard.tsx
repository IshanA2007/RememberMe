/**
 * PendingFaceCard — one unnamed face captured by Vision, awaiting a name.
 *
 * Editorial row with thumbnail left, inline naming form center, action
 * buttons right. No drop shadow; a 1px --rule border, inset --bg-white
 * fill, and asymmetric spacing carry the silhouette per frontend.mdc §5.3.
 *
 * Typography (frontend.mdc §1):
 *   - Name:         Fraunces 18px (display face; name is the hero input)
 *   - Relationship: Newsreader 16px (text face)
 *   - Description:  Newsreader 14px (text face)
 *   - "Captured":   JetBrains Mono 11px uppercase overline
 *   - Buttons:      Fraunces 16px
 */

import { useState, type ReactElement } from 'react';
import type {
  PendingFaceAcceptRequest,
  PendingFaceListItem,
} from '../types/api';

export interface PendingFaceCardProps {
  pendingFace: PendingFaceListItem;
  onAccept: (body: PendingFaceAcceptRequest) => void;
  onDismiss: () => void;
  busy?: boolean;
}

const NAME_MAX = 80;
const TITLE_MAX = 40;
const DESCRIPTION_MAX = 500;

/** Small relative-time helper so we don't pull in a library. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1 min ago';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? '1 hr ago' : `${diffHr} hrs ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
  const diffMo = Math.round(diffDay / 30);
  return diffMo === 1 ? '1 mo ago' : `${diffMo} mo ago`;
}

export function PendingFaceCard({
  pendingFace,
  onAccept,
  onDismiss,
  busy = false,
}: PendingFaceCardProps): ReactElement {
  const [name, setName] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const canSave = name.trim().length >= 1 && !busy;

  const handleAccept = (): void => {
    if (!canSave) return;
    onAccept({
      name: name.trim(),
      title: title.trim() ? title.trim() : null,
      description: description.trim() ? description.trim() : null,
    });
  };

  const thumbnailSrc = `data:${pendingFace.thumbnail_mime};base64,${pendingFace.thumbnail_b64}`;

  return (
    <article
      className="flex items-start"
      style={{
        gap: 24,
        padding: '20px 18px 22px',
        border: '1px solid var(--outline-variant)',
        backgroundColor: 'var(--bg-white)',
        borderRadius: 2,
      }}
    >
      {/* Thumbnail — 96×96 with its own rule border. */}
      <div
        style={{
          width: 96,
          height: 96,
          flexShrink: 0,
          border: '2px solid var(--outline-variant)',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: 'var(--bg-surface-container-lowest)',
        }}
      >
        <img
          src={thumbnailSrc}
          alt="Unknown face captured by Vision"
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>

      {/* Inline form — name hero, relationship + description below. */}
      <div className="flex flex-1 flex-col" style={{ gap: 8, minWidth: 0 }}>
        <div
          className="font-label uppercase text-tertiary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
          }}
        >
          Captured {relativeTime(pendingFace.captured_at)}
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          placeholder="Name (required)"
          disabled={busy}
          className="font-headline text-on-surface"
          style={{
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            border: '1px solid var(--outline-variant)',
            background: 'var(--bg-surface-container-lowest)',
            padding: '8px 10px',
            borderRadius: 2,
            color: 'var(--on-surface)',
          }}
          aria-label="Name"
          maxLength={NAME_MAX}
        />

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          placeholder="Relationship (e.g. daughter, friend)"
          disabled={busy}
          className="font-body text-on-surface"
          style={{
            fontSize: 16,
            border: '1px solid var(--outline-variant)',
            background: 'var(--bg-surface-container-lowest)',
            padding: '8px 10px',
            borderRadius: 2,
            color: 'var(--on-surface)',
          }}
          aria-label="Relationship"
          maxLength={TITLE_MAX}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
          placeholder="Description (optional)"
          disabled={busy}
          rows={2}
          className="font-body text-on-surface"
          style={{
            fontSize: 14,
            lineHeight: 1.55,
            border: '1px solid var(--outline-variant)',
            background: 'var(--bg-surface-container-lowest)',
            padding: '8px 10px',
            borderRadius: 2,
            color: 'var(--on-surface)',
            resize: 'vertical',
          }}
          aria-label="Description"
          maxLength={DESCRIPTION_MAX}
        />
      </div>

      {/* Actions — Accept is the dominant beat; Dismiss is the quiet one. */}
      <div
        className="flex flex-col"
        style={{ gap: 8, flexShrink: 0, alignSelf: 'flex-end' }}
      >
        <button
          type="button"
          onClick={handleAccept}
          disabled={!canSave}
          className="font-headline"
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            padding: '10px 18px',
            border: '1px solid var(--accent)',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-primary)',
            cursor: canSave ? 'pointer' : 'not-allowed',
            borderRadius: 2,
            lineHeight: 1.1,
            opacity: canSave ? 1 : 0.55,
          }}
        >
          {busy ? 'Saving…' : 'Accept'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="font-headline text-tertiary"
          style={{
            fontSize: 16,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            padding: '10px 18px',
            border: '1px solid var(--tertiary)',
            backgroundColor: 'transparent',
            color: 'var(--tertiary)',
            cursor: busy ? 'not-allowed' : 'pointer',
            borderRadius: 2,
            lineHeight: 1.1,
            opacity: busy ? 0.55 : 1,
          }}
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
