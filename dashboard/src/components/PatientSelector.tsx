/**
 * PatientSelector — caretaker-only list of assigned patients.
 *
 * NOT a native <select>. Rendered as a designed list where each row is a
 * button: Fraunces 24px name with a JetBrains Mono assignment timestamp
 * underneath. A 1px --rule hairline separates rows.
 */

import type { ReactElement } from 'react';
import type { PatientDirectoryEntry } from '../types/api';

export interface PatientSelectorProps {
  patients: PatientDirectoryEntry[];
  onSelect: (patientId: string) => void;
}

function relative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const day = 86400_000;
  if (diffMs < day) return 'assigned today';
  const days = Math.floor(diffMs / day);
  if (days < 30) return `assigned ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `assigned ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `assigned ${years} year${years === 1 ? '' : 's'} ago`;
}

export function PatientSelector({
  patients,
  onSelect,
}: PatientSelectorProps): ReactElement {
  if (patients.length === 0) {
    return (
      <div
        className="font-text text-ink-secondary"
        style={{ fontSize: 16, padding: '24px 0' }}
      >
        No patients assigned yet.
      </div>
    );
  }

  return (
    <ul
      className="flex flex-col"
      style={{ borderTop: '1px solid var(--rule)', listStyle: 'none', padding: 0, margin: 0 }}
    >
      {patients.map((p) => (
        <li key={p.patient_id} style={{ borderBottom: '1px solid var(--rule)' }}>
          <button
            type="button"
            onClick={() => onSelect(p.patient_id)}
            className="flex w-full items-baseline justify-between py-5"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-primary)',
              textAlign: 'left',
              padding: '20px 4px',
            }}
            aria-label={`Open ${p.display_name}`}
          >
            <span
              className="font-display text-ink-primary"
              style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}
            >
              {p.display_name}
            </span>
            <span
              className="font-mono uppercase text-ink-secondary"
              style={{ fontSize: 12, letterSpacing: '0.1em' }}
            >
              {relative(p.assigned_at)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
