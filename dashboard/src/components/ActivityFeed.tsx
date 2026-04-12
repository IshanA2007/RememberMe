/**
 * ActivityFeed — caretaker-only summary (FRONTEND_SPEC §2.4).
 *
 * Three vertical sections, stacked, with overline headers. NOT three
 * identical cards in a row — that's the forbidden SaaS silhouette
 * (frontend.mdc §5.1 / §6.3). Hairline rules (1px --rule) separate zones.
 *
 * Overlines: JetBrains Mono 11px uppercase tracking-wider, --ink-secondary.
 */

import type { ReactElement } from 'react';
import type {
  ActivityNewlyRecognizedFace,
  ActivityRecentConversationMemory,
  ActivityResponse,
  QuickInfoUpcomingReminder,
} from '../types/api';

export interface ActivityFeedProps {
  activity: ActivityResponse;
}

interface SectionProps {
  title: string;
  empty: string;
  isEmpty: boolean;
  children?: ReactElement | ReactElement[] | null;
}

function Overline({ children }: { children: string }): ReactElement {
  return (
    <div
      className="font-mono uppercase text-ink-secondary"
      style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        padding: '4px 0 12px',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      {children}
    </div>
  );
}

function Section({ title, empty, isEmpty, children }: SectionProps): ReactElement {
  return (
    <section style={{ paddingBottom: 28 }}>
      <Overline>{title}</Overline>
      {isEmpty ? (
        <div
          className="font-text text-ink-secondary"
          style={{ fontSize: 16, paddingTop: 16 }}
        >
          {empty}
        </div>
      ) : (
        <div className="flex flex-col" style={{ paddingTop: 4 }}>
          {children}
        </div>
      )}
    </section>
  );
}

function formatIsoShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} · ${hh}:${mm}`;
}

function RecognizedItem({ face }: { face: ActivityNewlyRecognizedFace }): ReactElement {
  return (
    <div
      className="flex items-baseline justify-between gap-6 py-3"
      style={{ borderBottom: '1px solid var(--rule)' }}
    >
      <span
        className="font-display text-ink-primary"
        style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {face.name}
      </span>
      <span
        className="font-mono uppercase text-ink-secondary"
        style={{ fontSize: 11, letterSpacing: '0.1em' }}
      >
        first seen {formatIsoShort(face.first_seen_at)}
      </span>
    </div>
  );
}

function ConversationItem({
  m,
}: {
  m: ActivityRecentConversationMemory;
}): ReactElement {
  return (
    <div
      className="flex flex-col gap-1 py-4"
      style={{ borderBottom: '1px solid var(--rule)' }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span
          className="font-display text-ink-primary"
          style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}
        >
          {m.face_name}
        </span>
        <span
          className="font-mono uppercase text-ink-secondary"
          style={{ fontSize: 11, letterSpacing: '0.1em' }}
        >
          {formatIsoShort(m.created_at)}
        </span>
      </div>
      <p
        className="font-text text-ink-primary"
        style={{ fontSize: 16, lineHeight: 1.55, margin: 0, maxWidth: '62ch' }}
      >
        {m.content}
      </p>
    </div>
  );
}

function ReminderItem({ r }: { r: QuickInfoUpcomingReminder }): ReactElement {
  return (
    <div
      className="flex items-baseline justify-between gap-6 py-3"
      style={{ borderBottom: '1px solid var(--rule)' }}
    >
      <span
        className="font-display text-ink-primary"
        style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}
      >
        {r.title}
      </span>
      <span
        className="font-mono uppercase text-ink-secondary"
        style={{ fontSize: 11, letterSpacing: '0.1em' }}
      >
        {formatIsoShort(r.trigger_at)}
      </span>
    </div>
  );
}

export function ActivityFeed({ activity }: ActivityFeedProps): ReactElement {
  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <Section
        title="Newly Recognized"
        empty="No new faces in the last 7 days."
        isEmpty={activity.newly_recognized_faces.length === 0}
      >
        {activity.newly_recognized_faces.map((f) => (
          <RecognizedItem key={f.face_id} face={f} />
        ))}
      </Section>

      <Section
        title="Recent Conversations"
        empty="No conversation memories captured recently."
        isEmpty={activity.recent_conversation_memories.length === 0}
      >
        {activity.recent_conversation_memories.map((m) => (
          <ConversationItem key={m.memory_id} m={m} />
        ))}
      </Section>

      <Section
        title="Upcoming Reminders"
        empty="No reminders in the next 7 days."
        isEmpty={activity.upcoming_reminders.length === 0}
      >
        {activity.upcoming_reminders.map((r) => (
          <ReminderItem key={r.reminder_id} r={r} />
        ))}
      </Section>
    </div>
  );
}
