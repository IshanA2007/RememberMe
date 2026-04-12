/**
 * CaretakerReminders — `/caretaker/:patient_id/reminders`.
 *
 * Same layout as patient reminders, but edit controls are always available
 * (no toggle). Caretaker has full CRUD over the patient's reminders
 * (API_SPEC §0.4).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Header } from '../../components/Header';
import { CalendarGrid } from '../../components/CalendarGrid';
import { ReminderList } from '../../components/ReminderList';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import {
  createReminder,
  deleteReminder,
  listPatients,
  listReminders,
  updateReminder,
} from '../../services/rest_client';
import type {
  PatientDirectoryResponse,
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

function localInputToIsoUtc(v: string): string {
  return new Date(v).toISOString();
}

function isoUtcToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

interface ReminderFormValues {
  title: string;
  description: string;
  trigger_at: string;
}

function emptyForm(defaultDate: Date): ReminderFormValues {
  return {
    title: '',
    description: '',
    trigger_at: isoUtcToLocalInput(defaultDate.toISOString()),
  };
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

export function CaretakerRemindersPage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const fetcher = useAuthedFetch();
  const { patient_id } = useParams<{ patient_id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeDay, setActiveDay] = useState<Date>(() => startOfDayUtc(new Date()));
  const [adding, setAdding] = useState(false);
  const [addValues, setAddValues] = useState<ReminderFormValues>(() =>
    emptyForm(new Date(Date.now() + 60 * 60_000)),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<ReminderFormValues>(() =>
    emptyForm(new Date()),
  );

  const patientsQuery = useQuery<PatientDirectoryResponse>({
    queryKey: ['patients'],
    staleTime: 15_000,
    queryFn: () => listPatients(fetcher),
  });

  const { data } = useQuery<ReminderListResponse>({
    queryKey: ['reminders', patient_id],
    enabled: Boolean(patient_id),
    staleTime: 15_000,
    queryFn: () => listReminders(fetcher, patient_id as string),
  });

  const patient = useMemo(
    () => patientsQuery.data?.patients.find((p) => p.patient_id === patient_id),
    [patientsQuery.data, patient_id],
  );

  const reminders = data?.reminders ?? [];

  const todayReminders = useMemo(
    () => reminders.filter((r) => sameUtcDay(new Date(r.trigger_at), new Date())),
    [reminders],
  );

  const selectedDayReminders = useMemo(
    () => reminders.filter((r) => sameUtcDay(new Date(r.trigger_at), activeDay)),
    [reminders, activeDay],
  );

  const createMut = useMutation({
    mutationFn: async (): Promise<ReminderObject> => {
      if (!patient_id) throw new Error('No patient selected');
      const iso = localInputToIsoUtc(addValues.trigger_at);
      return createReminder(fetcher, patient_id, {
        title: addValues.title.trim(),
        description: addValues.description.trim()
          ? addValues.description.trim()
          : null,
        trigger_at: iso,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders', patient_id] });
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
      void qc.invalidateQueries({ queryKey: ['reminders', patient_id] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (reminderId: string): Promise<void> => {
      await deleteReminder(fetcher, reminderId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders', patient_id] });
    },
  });

  if (!me || !patient_id) return <div />;

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

  const patientName = patient?.display_name ?? 'Patient';

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="caretaker"
        name={patientName}
        description={`Caretaker view · ${me.display_name}`}
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px' }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            paddingBottom: 10,
            borderBottom: '1px solid var(--outline-variant)',
            marginBottom: 24,
          }}
        >
          <span
            className="font-label uppercase text-tertiary"
            style={{ fontSize: 11, letterSpacing: '0.14em' }}
          >
            Caretaker · {patientName} · Reminders
          </span>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="font-headline uppercase"
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.14em',
                padding: '12px 22px',
                border: '1px solid var(--accent)',
                backgroundColor: 'var(--accent)',
                color: 'var(--on-primary)',
                cursor: 'pointer',
                borderRadius: 8,
                lineHeight: 1,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
              aria-label="Add a new reminder for this patient"
            >
              + Add reminder
            </button>
          ) : null}
        </div>

        {adding ? (
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
        ) : null}

        <section style={{ paddingBottom: 32 }}>
          <div
            className="font-label uppercase text-tertiary"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              paddingBottom: 10,
              marginTop: 24,
              borderBottom: '1px solid var(--outline-variant)',
            }}
          >
            Today
          </div>
          <ReminderList
            reminders={todayReminders}
            onEdit={handleStartEdit}
            onDelete={handleDelete}
          />
        </section>

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
            onEdit={handleStartEdit}
            onDelete={handleDelete}
          />
        </section>
      </main>

      <div
        className="flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--outline-variant)',
          padding: '16px 40px',
        }}
      >
        <button
          type="button"
          onClick={() => navigate(`/caretaker/${patient_id}`)}
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
