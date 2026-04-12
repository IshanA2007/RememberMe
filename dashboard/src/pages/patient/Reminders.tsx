/**
 * PatientRemindersPage — `/patient/reminders` (FRONTEND_SPEC §2.3).
 *
 * Structure:
 *   - `TODAY` overline + today's date in Fraunces 48px
 *   - list of today's reminders
 *   - CalendarGrid (7-day week)
 *   - list of selected-day reminders (below calendar)
 *   - Bottom-right `Edit` toggle enables add / edit / delete per row
 *
 * Patient has full CRUD over their own reminders (API_SPEC §0.4).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Header } from '../../components/Header';
import { CalendarGrid } from '../../components/CalendarGrid';
import { ReminderList } from '../../components/ReminderList';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import {
  createReminder,
  deleteReminder,
  listReminders,
  updateReminder,
} from '../../services/rest_client';
import type {
  ReminderListResponse,
  ReminderObject,
} from '../../types/api';

const DESCRIPTION_MAX = 280;
const TITLE_MAX = 80;

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isSameOrAfter(a: Date, b: Date): boolean {
  return a.getTime() >= b.getTime();
}

/**
 * Convert a `<input type="datetime-local">` value (local-time string with no
 * trailing zone, e.g. `"2026-04-12T14:00"`) to an ISO UTC `Z` string.
 */
function localInputToIsoUtc(v: string): string {
  // Parsing without a trailing Z uses the browser's local zone.
  const d = new Date(v);
  return d.toISOString();
}

function isoUtcToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatTodayHeadline(d: Date): string {
  // "APR 12" style — mono-friendly month + day number in JetBrains Mono /
  // Fraunces split (the Fraunces 48px caller wraps this).
  const weekday = d.toLocaleString('en-US', { weekday: 'long' });
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  return `${weekday}, ${month} ${day}`;
}

interface ReminderFormValues {
  title: string;
  description: string;
  trigger_at: string; // datetime-local format
}

function emptyForm(defaultDate: Date): ReminderFormValues {
  const iso = defaultDate.toISOString();
  return { title: '', description: '', trigger_at: isoUtcToLocalInput(iso) };
}

interface InlineReminderFormProps {
  values: ReminderFormValues;
  onChange: (next: ReminderFormValues) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  label: string;
}

function InlineReminderForm({
  values,
  onChange,
  onCancel,
  onSubmit,
  submitting,
  label,
}: InlineReminderFormProps): ReactElement {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 10,
        padding: '16px 0 20px',
        borderBottom: '1px solid var(--outline-variant)',
      }}
    >
      <div
        className="font-label uppercase text-tertiary"
        style={{ fontSize: 11, letterSpacing: '0.14em' }}
      >
        {label}
      </div>
      <input
        type="text"
        value={values.title}
        onChange={(e) =>
          onChange({ ...values, title: e.target.value.slice(0, TITLE_MAX) })
        }
        placeholder="Title"
        className="font-headline text-on-surface"
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          border: '1px solid var(--outline-variant)',
          background: 'var(--bg-surface-container-lowest)',
          padding: '10px 12px',
          borderRadius: 2,
          color: 'var(--on-surface)',
        }}
        aria-label="Reminder title"
      />
      <textarea
        value={values.description}
        onChange={(e) =>
          onChange({
            ...values,
            description: e.target.value.slice(0, DESCRIPTION_MAX),
          })
        }
        placeholder="Description (optional)"
        className="font-body text-on-surface"
        style={{
          fontSize: 16,
          lineHeight: 1.5,
          border: '1px solid var(--outline-variant)',
          background: 'var(--bg-surface-container-lowest)',
          padding: '10px 12px',
          borderRadius: 2,
          minHeight: 72,
          color: 'var(--on-surface)',
          resize: 'vertical',
        }}
        aria-label="Reminder description"
      />
      <input
        type="datetime-local"
        value={values.trigger_at}
        onChange={(e) => onChange({ ...values, trigger_at: e.target.value })}
        className="font-label text-on-surface"
        style={{
          fontSize: 14,
          border: '1px solid var(--outline-variant)',
          background: 'var(--bg-surface-container-lowest)',
          padding: '8px 10px',
          borderRadius: 2,
          color: 'var(--on-surface)',
        }}
        aria-label="Trigger time"
      />
      <div className="flex items-center justify-end" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          className="font-headline uppercase text-tertiary"
          style={{
            fontSize: 12,
            letterSpacing: '0.12em',
            padding: '6px 12px',
            border: '1px solid var(--outline-variant)',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !values.title.trim() || !values.trigger_at}
          className="font-headline uppercase"
          style={{
            fontSize: 12,
            letterSpacing: '0.12em',
            padding: '6px 12px',
            border: '1px solid var(--accent)',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-primary)',
            cursor: submitting ? 'not-allowed' : 'pointer',
            borderRadius: 2,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function PatientRemindersPage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();
  const qc = useQueryClient();

  const patientId = me?.user_id ?? '';

  const now = useMemo(() => new Date(), []);
  const [activeDay, setActiveDay] = useState<Date>(() => startOfDayUtc(new Date()));
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addValues, setAddValues] = useState<ReminderFormValues>(() =>
    emptyForm(new Date(Date.now() + 60 * 60_000)),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<ReminderFormValues>(() =>
    emptyForm(new Date()),
  );

  const { data } = useQuery<ReminderListResponse>({
    queryKey: ['reminders', patientId],
    enabled: Boolean(patientId),
    staleTime: 15_000,
    queryFn: () => listReminders(fetcher, patientId),
  });

  const reminders = data?.reminders ?? [];

  const todayReminders = useMemo(
    () =>
      reminders.filter((r) => sameUtcDay(new Date(r.trigger_at), new Date())),
    [reminders],
  );

  const selectedDayReminders = useMemo(
    () =>
      reminders.filter((r) => sameUtcDay(new Date(r.trigger_at), activeDay)),
    [reminders, activeDay],
  );

  const createMut = useMutation({
    mutationFn: async (): Promise<ReminderObject> => {
      const iso = localInputToIsoUtc(addValues.trigger_at);
      const when = new Date(iso);
      if (!isSameOrAfter(when, now)) {
        throw new Error('Trigger time must be in the future');
      }
      return createReminder(fetcher, patientId, {
        title: addValues.title.trim(),
        description: addValues.description.trim()
          ? addValues.description.trim()
          : null,
        trigger_at: iso,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders', patientId] });
      setAdding(false);
      setAddValues(emptyForm(new Date(Date.now() + 60 * 60_000)));
    },
  });

  const updateMut = useMutation({
    mutationFn: async (): Promise<ReminderObject> => {
      if (!editingId) throw new Error('No reminder selected');
      const iso = localInputToIsoUtc(editValues.trigger_at);
      return updateReminder(fetcher, editingId, {
        title: editValues.title.trim(),
        description: editValues.description.trim()
          ? editValues.description.trim()
          : null,
        trigger_at: iso,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders', patientId] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (reminderId: string): Promise<void> => {
      await deleteReminder(fetcher, reminderId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders', patientId] });
    },
  });

  if (!me) return <div />;

  const handleStartEdit = (r: ReminderObject): void => {
    setEditingId(r.reminder_id);
    setEditValues({
      title: r.title,
      description: r.description ?? '',
      trigger_at: isoUtcToLocalInput(r.trigger_at),
    });
  };

  const handleDelete = (r: ReminderObject): void => {
    deleteMut.mutate(r.reminder_id);
  };

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="Today and the days ahead."
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px' }}
      >
        {/* TODAY banner */}
        <section style={{ paddingBottom: 32 }}>
          <div
            className="flex items-center justify-between"
            style={{
              paddingBottom: 10,
              borderBottom: '1px solid var(--outline-variant)',
            }}
          >
            <span
              className="font-label uppercase text-tertiary"
              style={{ fontSize: 11, letterSpacing: '0.14em' }}
            >
              Today
            </span>
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="font-headline uppercase"
                style={{
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  padding: '8px 14px',
                  border: '1px solid var(--accent)',
                  backgroundColor: 'var(--accent)',
                  color: 'var(--on-primary)',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
                aria-label="Add a new reminder"
              >
                + Add reminder
              </button>
            ) : null}
          </div>
          <h2
            className="font-headline text-on-surface"
            style={{
              fontSize: 48,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              margin: 0,
              paddingTop: 12,
            }}
          >
            {formatTodayHeadline(new Date())}
          </h2>
        </section>

        {/* Inline add form — shown when user clicks Add reminder.
            Rendered at the top so it's immediately in view regardless of
            which calendar day is selected below. */}
        {adding ? (
          <section style={{ paddingBottom: 24 }}>
            <InlineReminderForm
              values={addValues}
              onChange={setAddValues}
              onCancel={() => {
                setAdding(false);
                setAddValues(emptyForm(new Date(Date.now() + 60 * 60_000)));
              }}
              onSubmit={() => createMut.mutate()}
              submitting={createMut.isPending}
              label="New reminder"
            />
          </section>
        ) : null}

        {/* Today's reminders */}
        <section style={{ paddingBottom: 40 }}>
          <ReminderList
            reminders={todayReminders}
            onEdit={editMode ? handleStartEdit : undefined}
            onDelete={editMode ? handleDelete : undefined}
          />
        </section>

        {/* 7-day calendar */}
        <section style={{ paddingBottom: 32 }}>
          <div
            className="font-label uppercase text-tertiary"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              paddingBottom: 12,
              borderBottom: '1px solid var(--outline-variant)',
              marginBottom: 12,
            }}
          >
            This Week
          </div>
          <CalendarGrid
            reminders={reminders}
            activeDay={activeDay}
            onSelectDay={setActiveDay}
          />
        </section>

        {/* Selected day reminders */}
        <section style={{ paddingBottom: 24 }}>
          <div
            className="font-label uppercase text-tertiary"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              paddingBottom: 10,
              borderBottom: '1px solid var(--outline-variant)',
              marginBottom: 4,
            }}
          >
            {activeDay.toUTCString().slice(0, 16)}
          </div>

          {editingId ? (
            <InlineReminderForm
              values={editValues}
              onChange={setEditValues}
              onCancel={() => setEditingId(null)}
              onSubmit={() => updateMut.mutate()}
              submitting={updateMut.isPending}
              label="Edit reminder"
            />
          ) : null}

          <ReminderList
            reminders={selectedDayReminders}
            onEdit={editMode ? handleStartEdit : undefined}
            onDelete={editMode ? handleDelete : undefined}
          />
        </section>
      </main>

      {/* Bottom bar: Home / Edit (toggle + add) / Logout */}
      <div
        className="flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--outline-variant)',
          padding: '16px 40px',
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/patient')}
          className="font-headline uppercase text-on-surface"
          style={{
            fontSize: 14,
            letterSpacing: '0.14em',
            padding: '10px 16px',
            border: '1px solid var(--on-surface)',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          Home
        </button>

        <div className="flex items-center" style={{ gap: 8 }}>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="font-headline uppercase"
              style={{
                fontSize: 14,
                letterSpacing: '0.14em',
                padding: '10px 16px',
                border: '1px solid var(--accent)',
                backgroundColor: 'var(--accent)',
                color: 'var(--on-primary)',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              Add reminder
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className="font-headline uppercase text-on-surface"
            style={{
              fontSize: 14,
              letterSpacing: '0.14em',
              padding: '10px 16px',
              border: '1px solid var(--on-surface)',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 2,
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => auth.logout()}
          className="font-headline uppercase text-on-surface"
          style={{
            fontSize: 14,
            letterSpacing: '0.14em',
            padding: '10px 16px',
            border: '1px solid var(--on-surface)',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
