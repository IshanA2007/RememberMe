/**
 * ReminderRow — two-column editorial entry for a reminder.
 *
 *   [ time overline ]  [ title + description ]
 *     JetBrains Mono      Fraunces 20   Newsreader 16
 *     --ink-secondary     --ink-primary --ink-secondary
 *
 * No card chrome. A hairline --rule between rows carries rhythm.
 */

import type { ReactElement } from 'react';
import type { ReminderObject } from '../types/api';

export interface ReminderRowProps {
  reminder: ReminderObject;
  onEdit?: (r: ReminderObject) => void;
  onDelete?: (r: ReminderObject) => void;
}

function formatTime(iso: string): { line1: string; line2: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { line1: iso, line2: '' };
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const month = d
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { line1: `${hh}:${mm}`, line2: `${month} ${day}` };
}

export function ReminderRow({ reminder, onEdit, onDelete }: ReminderRowProps): ReactElement {
  const { line1, line2 } = formatTime(reminder.trigger_at);

  return (
    <article
      className="group grid py-5"
      style={{
        gridTemplateColumns: '96px 1fr auto',
        gap: 24,
        alignItems: 'start',
        borderBottom: '1px solid var(--outline-variant)',
      }}
    >
      <div className="flex flex-col">
        <span
          className="font-label text-on-surface"
          style={{ fontSize: 18, letterSpacing: '0.04em', fontWeight: 500 }}
        >
          {line1}
        </span>
        <span
          className="font-label uppercase text-tertiary"
          style={{ fontSize: 11, letterSpacing: '0.1em', marginTop: 2 }}
        >
          {line2}
        </span>
      </div>

      <div className="flex flex-col">
        <h3
          className="font-headline text-on-surface"
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            lineHeight: 1.15,
            margin: 0,
          }}
        >
          {reminder.title}
        </h3>
        {reminder.description ? (
          <p
            className="font-body text-tertiary"
            style={{ fontSize: 16, lineHeight: 1.5, marginTop: 6, maxWidth: '62ch' }}
          >
            {reminder.description}
          </p>
        ) : null}
      </div>

      {onEdit || onDelete ? (
        <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
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
              onClick={() => onEdit(reminder)}
              aria-label={`Edit reminder ${reminder.title}`}
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
              onClick={() => onDelete(reminder)}
              aria-label={`Delete reminder ${reminder.title}`}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
