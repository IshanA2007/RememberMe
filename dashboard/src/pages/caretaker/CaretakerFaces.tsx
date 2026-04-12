/**
 * CaretakerFaces — `/caretaker/:patient_id/faces`.
 *
 * Same MemoryTree silhouette as the patient view, plus an "Add person"
 * inline form — caretakers may pre-register faces without embeddings;
 * Vision will attach the embedding once it sees them (API_SPEC §3.2).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Header } from '../../components/Header';
import { MemoryTree } from '../../components/MemoryTree';
import { PendingFacesSection } from '../../components/PendingFacesSection';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import {
  createFace,
  listFaces,
  listPatients,
} from '../../services/rest_client';
import type {
  FaceCreateRequest,
  FaceListResponse,
  FaceObject,
  PatientDirectoryResponse,
} from '../../types/api';

const NAME_MAX = 80;
const TITLE_MAX = 40;
const DESCRIPTION_MAX = 500;

export function CaretakerFacesPage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const fetcher = useAuthedFetch();
  const { patient_id } = useParams<{ patient_id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const patientsQuery = useQuery<PatientDirectoryResponse>({
    queryKey: ['patients'],
    staleTime: 15_000,
    queryFn: () => listPatients(fetcher),
  });

  const facesQuery = useQuery<FaceListResponse>({
    queryKey: ['faces', patient_id],
    enabled: Boolean(patient_id),
    staleTime: 15_000,
    queryFn: () => listFaces(fetcher, patient_id as string),
  });

  const patient = useMemo(
    () => patientsQuery.data?.patients.find((p) => p.patient_id === patient_id),
    [patientsQuery.data, patient_id],
  );

  const createMut = useMutation({
    mutationFn: async (): Promise<FaceObject> => {
      if (!patient_id) throw new Error('No patient selected');
      if (!newName.trim()) throw new Error('Name is required');
      const body: FaceCreateRequest = {
        name: newName.trim(),
        title: newTitle.trim() ? newTitle.trim() : null,
        description: newDescription.trim() ? newDescription.trim() : null,
      };
      return createFace(fetcher, patient_id, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['faces', patient_id] });
      setAdding(false);
      setNewName('');
      setNewTitle('');
      setNewDescription('');
    },
  });

  if (!me || !patient_id) return <div />;

  const faces: FaceObject[] = facesQuery.data?.faces ?? [];
  const patientName = patient?.display_name ?? 'Patient';

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="caretaker"
        name={patientName}
        description="Manage the people in this patient's life."
      />

      <main
        className="flex-1"
        style={{ padding: '32px 40px' }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            paddingBottom: 12,
            borderBottom: '1px solid var(--outline-variant)',
            marginBottom: 24,
          }}
        >
          <span
            className="font-label uppercase text-tertiary"
            style={{ fontSize: 11, letterSpacing: '0.14em' }}
          >
            Caretaker · {patientName} · People
          </span>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="font-headline"
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                padding: '10px 18px',
                border: '1px solid var(--on-surface)',
                background: 'transparent',
                color: 'var(--on-surface)',
                cursor: 'pointer',
                borderRadius: 2,
                lineHeight: 1,
              }}
            >
              Add person
            </button>
          ) : null}
        </div>

        <PendingFacesSection patientId={patient_id} />

        {adding ? (
          <section
            style={{
              padding: '12px 0 28px',
              borderBottom: '1px solid var(--outline-variant)',
              marginBottom: 24,
            }}
          >
            <div
              className="font-label uppercase text-tertiary"
              style={{ fontSize: 11, letterSpacing: '0.14em', paddingBottom: 10 }}
            >
              New person
            </div>
            <div className="flex flex-col" style={{ gap: 10, maxWidth: '62ch' }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value.slice(0, NAME_MAX))}
                placeholder="Name (required)"
                className="font-headline text-on-surface"
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--bg-surface-container-lowest)',
                  padding: '10px 12px',
                  borderRadius: 2,
                  color: 'var(--on-surface)',
                }}
                aria-label="Name"
              />
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="Title (e.g. daughter, doctor)"
                className="font-body text-tertiary"
                style={{
                  fontSize: 18,
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--bg-surface-container-lowest)',
                  padding: '10px 12px',
                  borderRadius: 2,
                  color: 'var(--tertiary)',
                }}
                aria-label="Title"
              />
              <textarea
                value={newDescription}
                onChange={(e) =>
                  setNewDescription(e.target.value.slice(0, DESCRIPTION_MAX))
                }
                placeholder="Description (optional)"
                className="font-body text-on-surface"
                style={{
                  fontSize: 16,
                  lineHeight: 1.55,
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--bg-surface-container-lowest)',
                  padding: '10px 12px',
                  borderRadius: 2,
                  minHeight: 80,
                  color: 'var(--on-surface)',
                  resize: 'vertical',
                }}
                aria-label="Description"
              />
              <div className="flex items-center justify-end" style={{ gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewName('');
                    setNewTitle('');
                    setNewDescription('');
                  }}
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
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending || !newName.trim()}
                  className="font-headline uppercase"
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    padding: '6px 12px',
                    border: '1px solid var(--accent)',
                    backgroundColor: 'var(--accent)',
                    color: 'var(--on-primary)',
                    cursor: createMut.isPending ? 'not-allowed' : 'pointer',
                    borderRadius: 2,
                    opacity: createMut.isPending ? 0.6 : 1,
                  }}
                >
                  Save person
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {facesQuery.isLoading ? (
          <p
            className="font-body text-tertiary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            Loading…
          </p>
        ) : faces.length === 0 ? (
          <p
            className="font-body text-tertiary"
            style={{ fontSize: 18, padding: '48px 0', maxWidth: '62ch' }}
          >
            No people registered yet. Use “Add person” above to pre-register
            family and friends — Vision will attach their likeness the first
            time it sees them.
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
              centerName={patientName}
              faces={faces}
              onFaceClick={(f) =>
                navigate(`/caretaker/${patient_id}/faces/${f.face_id}`)
              }
            />
          </div>
        )}
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
