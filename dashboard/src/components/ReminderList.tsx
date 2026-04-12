/**
 * ReminderList — chronological list of ReminderRows.
 */

import type { ReactElement } from 'react';
import type { ReminderObject } from '../types/api';
import { ReminderRow } from './ReminderRow';

export interface ReminderListProps {
  reminders: ReminderObject[];
  onEdit?: (r: ReminderObject) => void;
  onDelete?: (r: ReminderObject) => void;
}

function byTriggerAsc(a: ReminderObject, b: ReminderObject): number {
  if (a.trigger_at < b.trigger_at) return -1;
  if (a.trigger_at > b.trigger_at) return 1;
  return 0;
}

export function ReminderList({
  reminders,
  onEdit,
  onDelete,
}: ReminderListProps): ReactElement {
  const sorted = [...reminders].sort(byTriggerAsc);

  if (sorted.length === 0) {
    return (
      <div
        className="font-text text-ink-secondary"
        style={{ fontSize: 16, padding: '24px 0' }}
      >
        No reminders scheduled.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{ borderTop: '1px solid var(--rule)' }}
    >
      {sorted.map((r) => (
        <ReminderRow key={r.reminder_id} reminder={r} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
