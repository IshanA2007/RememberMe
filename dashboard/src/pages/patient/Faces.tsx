/**
 * PatientFacesPage — `/patient/faces` (FRONTEND_SPEC §2.3).
 *
 * MemoryTree centered on the patient's name. Face nodes are clickable and
 * route to `/patient/faces/:id`.
 *
 * Patient MUST NOT add a new face here (no UI). Only caretaker or Vision
 * (embedding upload) can register a face.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';

import { Header } from '../../components/Header';
import { MemoryTree } from '../../components/MemoryTree';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import { listFaces } from '../../services/rest_client';
import type { FaceListResponse, FaceObject } from '../../types/api';

export function PatientFacesPage(): ReactElement {
  const { me } = useMe();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();
  const auth = useAppAuth();

  const patientId = me?.user_id ?? '';

  const { data, isLoading, error } = useQuery<FaceListResponse>({
    queryKey: ['faces', patientId],
    enabled: Boolean(patientId),
    staleTime: 15_000,
    queryFn: () => listFaces(fetcher, patientId),
  });

  if (!me) return <div />;

  const faces: FaceObject[] = data?.faces ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="The people in your life."
      />

      <main
        className="flex-1"
        style={{ padding: '32px 40px' }}
      >
        <div
          className="font-mono uppercase text-ink-secondary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            paddingBottom: 12,
            borderBottom: '1px solid var(--rule)',
            marginBottom: 24,
          }}
        >
          My People
        </div>

        {isLoading ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            Loading…
          </p>
        ) : error ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            Could not load people.
          </p>
        ) : faces.length === 0 ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 18, padding: '48px 0', maxWidth: '62ch' }}
          >
            No people have been added yet. A caretaker can add family and
            friends, and the Vision app will recognize them in person.
          </p>
        ) : (
          <div
            style={{
              width: '100%',
              minHeight: 640,
              height: 'min(72vh, 720px)',
            }}
          >
            <MemoryTree
              centerName={me.display_name}
              faces={faces}
              onFaceClick={(f) => navigate(`/patient/faces/${f.face_id}`)}
            />
          </div>
        )}
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
          onClick={() => navigate('/patient')}
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
          Home
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
