/**
 * PatientSelector — caregiver patient card list.
 *
 * Displays each assigned patient as an interactive card with name,
 * assignment date, and hover effects.
 */

import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
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
        className="text-tertiary text-center py-8"
        style={{ fontSize: 16 }}
      >
        No patients assigned yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {patients.map((p, idx) => (
        <button
          key={p.patient_id}
          type="button"
          onClick={() => onSelect(p.patient_id)}
          className="group p-6 rounded-2xl transition-all duration-300 text-left border-none cursor-pointer"
          style={{
            background: 'var(--surface-container-low)',
            color: 'var(--on-surface)',
            animation: `slideUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)`,
            animationDelay: `${0.15 + idx * 0.1}s`,
            animationFillMode: 'both',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.12)';
            e.currentTarget.style.background = 'white';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.background = 'var(--surface-container-low)';
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3
              className="font-headline font-bold"
              style={{
                fontSize: 18,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {p.display_name}
            </h3>
            <ChevronRight
              size={20}
              style={{
                opacity: 0,
                transition: 'all 0.3s',
                transform: 'translateX(-8px)',
              }}
              className="group-hover:opacity-100 group-hover:translate-x-0"
            />
          </div>
          <p
            className="text-tertiary text-xs uppercase tracking-widest font-label"
            style={{
              margin: 0,
              letterSpacing: '0.1em',
            }}
          >
            {relative(p.assigned_at)}
          </p>
        </button>
      ))}
    </div>
  );
}
