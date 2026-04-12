/**
 * MemoryRow — a single memory laid out as an editorial chronology entry.
 *
 * Structure (frontend.mdc §6.2):
 *   ┌─ tiny date overline (JetBrains Mono 12px uppercase, --ink-secondary)
 *   │  [ source-badge ]
 *   └─ memory content — Newsreader 18px, --ink-primary (the visual hero)
 *
 * Edit/Delete controls only render when `canEdit === true`. They live
 * inline on the right, as ghost buttons that become visible on hover or
 * keyboard focus.
 */

import type { ReactElement } from 'react';
import type { MemoryObject, MemorySource } from '../types/api';

export interface MemoryRowProps {
  memory: MemoryObject;
  canEdit: boolean;
  onEdit?: (memory: MemoryObject) => void;
  onDelete?: (memory: MemoryObject) => void;
}

const SOURCE_LABEL: Record<MemorySource, string> = {
  conversation: 'conversation',
  manual: 'note',
  caretaker: 'caretaker',
};

function formatDateOverline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Example: `APR 08 · 16:20`
  const month = d
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} · ${hh}:${mm}`;
}

export function MemoryRow({
  memory,
  canEdit,
  onEdit,
  onDelete,
}: MemoryRowProps): ReactElement {
  return (
    <article
      className="group flex flex-col gap-2 py-6"
      style={{ borderBottom: '1px solid var(--outline-variant)' }}
    >
      <div className="flex items-center gap-3">
        <span
          className="font-label uppercase text-tertiary"
          style={{ fontSize: 12, letterSpacing: '0.08em' }}
        >
          {formatDateOverline(memory.created_at)}
        </span>
        <span
          className="font-label uppercase text-tertiary"
          style={{
            fontSize: 11,
            letterSpacing: '0.1em',
            border: '1px solid var(--outline-variant)',
            padding: '2px 6px',
            borderRadius: 2,
            color: 'var(--tertiary)',
          }}
        >
          {SOURCE_LABEL[memory.source]}
        </span>
      </div>

      <div className="flex items-start justify-between gap-6">
        <p
          className="font-body text-on-surface"
          style={{ fontSize: 18, lineHeight: 1.55, margin: 0, maxWidth: '62ch' }}
        >
          {memory.content}
        </p>

        {canEdit ? (
          <div
            className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {onEdit ? (
              <button
                type="button"
                className="font-body text-tertiary"
                style={{
                  fontSize: 14,
                  padding: '4px 8px',
                  border: '1px solid transparent',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => onEdit(memory)}
                aria-label={`Edit memory from ${formatDateOverline(memory.created_at)}`}
              >
                Edit
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="font-body text-tertiary"
                style={{
                  fontSize: 14,
                  padding: '4px 8px',
                  border: '1px solid transparent',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => onDelete(memory)}
                aria-label={`Delete memory from ${formatDateOverline(memory.created_at)}`}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
