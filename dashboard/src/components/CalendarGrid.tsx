/**
 * CalendarGrid — 7-day week view for reminders (FRONTEND_SPEC §2.3).
 *
 * No grid lines between cells — just spacing carries structure. Each day
 * is a column with:
 *   - day-of-week abbreviation (JetBrains Mono 12px uppercase)
 *   - date number (Fraunces 24px)
 *   - up to 5 dots (8px circles in --accent) representing reminders on
 *     that day; a trailing "+N" marker if there are more.
 *
 * The active day carries a 2px --accent underline. Columns are buttons for
 * keyboard and screen-reader accessibility.
 */

import type { ReactElement } from 'react';
import type { ReminderObject } from '../types/api';

export interface CalendarGridProps {
  reminders: ReminderObject[];
  activeDay: Date;
  onSelectDay: (d: Date) => void;
}

const DOW_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MAX_DOTS = 5;

function startOfWeek(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - dow);
  return copy;
}

function sameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function countOnDay(reminders: ReminderObject[], day: Date): number {
  return reminders.reduce((n, r) => {
    const rd = new Date(r.trigger_at);
    return sameUTCDay(rd, day) ? n + 1 : n;
  }, 0);
}

export function CalendarGrid({
  reminders,
  activeDay,
  onSelectDay,
}: CalendarGridProps): ReactElement {
  const weekStart = startOfWeek(activeDay);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime());
    d.setUTCDate(weekStart.getUTCDate() + i);
    return d;
  });

  return (
    <div
      className="grid w-full"
      style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}
      role="group"
      aria-label="Week calendar"
    >
      {days.map((day) => {
        const count = countOnDay(reminders, day);
        const isActive = sameUTCDay(day, activeDay);
        const dow = DOW_LABELS[day.getUTCDay()];
        const dayNum = day.getUTCDate();
        return (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onSelectDay(day)}
            className="flex flex-col items-center gap-2 py-4"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-primary)',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            }}
            aria-pressed={isActive}
            aria-label={`${dow} ${dayNum}, ${count} reminder${count === 1 ? '' : 's'}`}
          >
            <span
              className="font-mono uppercase text-ink-secondary"
              style={{ fontSize: 12, letterSpacing: '0.1em' }}
            >
              {dow}
            </span>
            <span
              className="font-display text-ink-primary"
              style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}
            >
              {dayNum}
            </span>

            <div
              className="flex items-center gap-1"
              style={{ minHeight: 10 }}
              aria-hidden
            >
              {Array.from({ length: Math.min(count, MAX_DOTS) }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: 'var(--accent)',
                  }}
                />
              ))}
              {count > MAX_DOTS ? (
                <span
                  className="font-mono text-ink-secondary"
                  style={{ fontSize: 11, marginLeft: 4 }}
                >
                  +{count - MAX_DOTS}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
