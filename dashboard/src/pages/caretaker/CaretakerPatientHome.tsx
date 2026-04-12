/**
 * CaretakerPatientHome — `/caretaker/:patient_id` (FRONTEND_SPEC §2.4).
 *
 * ActivityFeed is the hero (three editorial sections: newly recognized
 * faces, recent conversation memories, upcoming reminders). Below:
 * two large links to Manage People / Manage Reminders.
 *
 * Running head reads "CARETAKER · {display_name}" per frontend.mdc §6.3.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActivityFeed } from '../../components/ActivityFeed';
import { Header } from '../../components/Header';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import { getActivity, listPatients } from '../../services/rest_client';
import type {
  ActivityResponse,
  PatientDirectoryEntry,
  PatientDirectoryResponse,
} from '../../types/api';

interface IslandLinkProps {
  title: string;
  tagline: string;
  onClick: () => void;
  align: 'left' | 'right';
}

function IslandLink({ title, tagline, onClick, align }: IslandLinkProps): ReactElement {
  const alignClass = align === 'left' ? 'items-start text-left' : 'items-end text-right';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col justify-center gap-4 ${alignClass}`}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--ink-primary)',
        padding: '40px 16px',
        minHeight: 200,
      }}
    >
      <span
        className="font-display"
        style={{
          fontSize: 48,
          fontWeight: 600,
          letterSpacing: '-0.03em',
          lineHeight: 0.98,
        }}
      >
        {title}
      </span>
      <span
        className="font-text text-ink-secondary"
        style={{ fontSize: 16, lineHeight: 1.5, maxWidth: 360 }}
      >
        {tagline}
      </span>
    </button>
  );
}

export function CaretakerPatientHomePage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const fetcher = useAuthedFetch();
  const { patient_id } = useParams<{ patient_id: string }>();
  const navigate = useNavigate();

  const patientsQuery = useQuery<PatientDirectoryResponse>({
    queryKey: ['patients'],
    staleTime: 15_000,
    queryFn: () => listPatients(fetcher),
  });

  const activityQuery = useQuery<ActivityResponse>({
    queryKey: ['activity', patient_id],
    enabled: Boolean(patient_id),
    staleTime: 15_000,
    queryFn: () => getActivity(fetcher, patient_id as string),
  });

  const patient: PatientDirectoryEntry | undefined = useMemo(
    () => patientsQuery.data?.patients.find((p) => p.patient_id === patient_id),
    [patientsQuery.data, patient_id],
  );

  if (!me || !patient_id) return <div />;

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
          className="font-mono uppercase text-ink-secondary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            paddingBottom: 10,
            borderBottom: '1px solid var(--rule)',
            marginBottom: 24,
          }}
        >
          Caretaker · {patientName}
        </div>

        {activityQuery.isLoading ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            Loading…
          </p>
        ) : activityQuery.data ? (
          <ActivityFeed activity={activityQuery.data} />
        ) : (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            Could not load activity for this patient.
          </p>
        )}

        {/* Two asymmetric management links */}
        <section style={{ paddingTop: 32 }}>
          <div
            className="font-mono uppercase text-ink-secondary"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              paddingBottom: 10,
              borderBottom: '1px solid var(--rule)',
              marginBottom: 8,
            }}
          >
            Manage
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <IslandLink
              title="Manage People"
              tagline="Add, edit, and correct the faces in this patient's life."
              onClick={() => navigate(`/caretaker/${patient_id}/faces`)}
              align="left"
            />
            <div
              aria-hidden
              style={{ height: 1, backgroundColor: 'var(--rule)' }}
            />
            <IslandLink
              title="Manage Reminders"
              tagline="Schedule appointments, medication, and daily cues."
              onClick={() => navigate(`/caretaker/${patient_id}/reminders`)}
              align="right"
            />
          </div>
        </section>
      </main>

      <div
        className="flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--rule)',
          padding: '16px 40px',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/caretaker')}
          className="font-display uppercase text-ink-primary"
          style={{
            fontSize: 14,
            letterSpacing: '0.14em',
            padding: '10px 16px',
            border: '1px solid var(--ink-primary)',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          Patients
        </button>
        <button
          type="button"
          onClick={() => auth.logout()}
          className="font-display uppercase text-ink-primary"
          style={{
            fontSize: 14,
            letterSpacing: '0.14em',
            padding: '10px 16px',
            border: '1px solid var(--ink-primary)',
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
