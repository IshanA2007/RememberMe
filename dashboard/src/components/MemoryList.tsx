/**
 * MemoryList — a chronological, newest-first stack of MemoryRows.
 *
 * Keeps the visual silhouette of an editorial timeline (not a 3-col grid):
 * single vertical stream, hairline rules, dense but ordered.
 */

import type { ReactElement } from 'react';
import type { MemoryObject } from '../types/api';
import { MemoryRow } from './MemoryRow';

export interface MemoryListProps {
  memories: MemoryObject[];
  canEdit: (m: MemoryObject) => boolean;
  onEdit?: (m: MemoryObject) => void;
  onDelete?: (m: MemoryObject) => void;
}

function byCreatedDesc(a: MemoryObject, b: MemoryObject): number {
  // ISO 8601 strings sort lexicographically == chronologically.
  if (a.created_at < b.created_at) return 1;
  if (a.created_at > b.created_at) return -1;
  return 0;
}

export function MemoryList({
  memories,
  canEdit,
  onEdit,
  onDelete,
}: MemoryListProps): ReactElement {
  const sorted = [...memories].sort(byCreatedDesc);

  if (sorted.length === 0) {
    return (
      <div
        className="font-body text-tertiary"
        style={{ fontSize: 16, padding: '24px 0' }}
      >
        No memories yet.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{ borderTop: '1px solid var(--outline-variant)' }}
    >
      {sorted.map((m) => (
        <MemoryRow
          key={m.memory_id}
          memory={m}
          canEdit={canEdit(m)}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
