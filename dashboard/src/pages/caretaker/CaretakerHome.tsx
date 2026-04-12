/**
 * CaretakerHome — `/caretaker` (FRONTEND_SPEC §2.4).
 *
 * Fetches assigned patients. If exactly one, redirect to
 * `/caretaker/{patient_id}`. Otherwise render a designed list (PatientSelector,
 * NOT a native <select>).
 *
 * Running head reads "CARETAKER · YOUR PATIENTS" — per frontend.mdc §6.3 we
 * treat caretaker surfaces as warmer, with editorial motifs.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Header } from '../../components/Header';
import { PatientSelector } from '../../components/PatientSelector';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import { listPatients } from '../../services/rest_client';
import type { PatientDirectoryResponse } from '../../types/api';

export function CaretakerHomePage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();

  const { data } = useQuery<PatientDirectoryResponse>({
    queryKey: ['patients'],
    staleTime: 15_000,
    queryFn: () => listPatients(fetcher),
  });

  const patients = data?.patients ?? [];

  // Single-patient caretaker: skip the selector entirely.
  useEffect(() => {
    if (patients.length === 1) {
      navigate(`/caretaker/${patients[0].patient_id}`, { replace: true });
    }
  }, [patients, navigate]);

  if (!me) return <div />;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="caretaker"
        name={me.display_name}
        description="Your patients."
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px', maxWidth: 960 }}
      >
        <div
          className="font-mono uppercase text-ink-secondary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            paddingBottom: 12,
            borderBottom: '1px solid var(--rule)',
            marginBottom: 12,
          }}
        >
          Caretaker · Your Patients
        </div>

        {patients.length === 0 ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 18, padding: '40px 0', maxWidth: '62ch' }}
          >
            No patients are assigned to you yet.
          </p>
        ) : (
          <PatientSelector
            patients={patients}
            onSelect={(id) => navigate(`/caretaker/${id}`)}
          />
        )}
      </main>

      <div
        className="flex items-center justify-end"
        style={{
          borderTop: '1px solid var(--rule)',
          padding: '16px 40px',
        }}
      >
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
