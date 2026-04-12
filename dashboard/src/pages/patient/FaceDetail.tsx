/**
 * PatientFaceDetailPage — `/patient/faces/:id` (FRONTEND_SPEC §2.3).
 *
 * Face header (name / title / description) plus a chronological MemoryList.
 * Patient authority (API_SPEC §0.4):
 *   - may create `manual` memories
 *   - may edit / delete their own `manual` memories
 *   - may NOT touch `conversation` or `caretaker` memories
 *
 * Edit Mode toggles whether the header fields are editable and reveals
 * Save / Cancel buttons. Memory add/edit use inline expanding forms —
 * NOT modals (FRONTEND_SPEC §1.4; §2.3 allows inline forms in Dashboard).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Header } from '../../components/Header';
import { EditModeToggle } from '../../components/EditModeToggle';
import { MemoryList } from '../../components/MemoryList';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import {
  createMemory,
  deleteMemory,
  listFaces,
  listMemories,
  updateFace,
  updateMemory,
} from '../../services/rest_client';
import type {
  FaceListResponse,
  FaceObject,
  MemoryListResponse,
  MemoryObject,
} from '../../types/api';

const MEMORY_MAX = 280;

export function PatientFaceDetailPage(): ReactElement {
  const { me } = useMe();
  const { id: faceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();
  const auth = useAppAuth();
  const qc = useQueryClient();

  const patientId = me?.user_id ?? '';

  // Faces list used to find the face by id (hackathon shortcut per task spec).
  const facesQuery = useQuery<FaceListResponse>({
    queryKey: ['faces', patientId],
    enabled: Boolean(patientId),
    staleTime: 15_000,
    queryFn: () => listFaces(fetcher, patientId),
  });

  const memoriesQuery = useQuery<MemoryListResponse>({
    queryKey: ['memories', faceId],
    enabled: Boolean(faceId),
    staleTime: 15_000,
    queryFn: () => listMemories(fetcher, faceId as string),
  });

  const face: FaceObject | undefined = useMemo(
    () => facesQuery.data?.faces.find((f) => f.face_id === faceId),
    [facesQuery.data, faceId],
  );

  // Edit mode on face fields.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  // Add-memory inline form.
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState('');

  // Edit-memory inline state (one open at a time).
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');

  const updateFaceMut = useMutation({
    mutationFn: async (): Promise<FaceObject> => {
      if (!face) throw new Error('Face not loaded');
      return updateFace(fetcher, face.face_id, {
        name: draftName.trim(),
        title: draftTitle.trim() ? draftTitle.trim() : null,
        description: draftDescription.trim() ? draftDescription.trim() : null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['faces', patientId] });
      setEditing(false);
    },
  });

  const createMemoryMut = useMutation({
    mutationFn: async (): Promise<MemoryObject> => {
      if (!face) throw new Error('Face not loaded');
      const content = newMemoryContent.trim();
      if (!content) throw new Error('Memory is empty');
      return createMemory(fetcher, face.face_id, {
        content: content.slice(0, MEMORY_MAX),
        source: 'manual',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memories', faceId] });
      setAddingMemory(false);
      setNewMemoryContent('');
    },
  });

  const updateMemoryMut = useMutation({
    mutationFn: async (): Promise<MemoryObject> => {
      if (!editingMemoryId) throw new Error('No memory selected');
      const content = editingMemoryContent.trim();
      if (!content) throw new Error('Memory is empty');
      return updateMemory(fetcher, editingMemoryId, {
        content: content.slice(0, MEMORY_MAX),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memories', faceId] });
      setEditingMemoryId(null);
      setEditingMemoryContent('');
    },
  });

  const deleteMemoryMut = useMutation({
    mutationFn: async (memoryId: string): Promise<void> => {
      await deleteMemory(fetcher, memoryId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memories', faceId] });
    },
  });

  if (!me || !faceId) return <div />;

  const handleToggleEdit = (): void => {
    if (!face) return;
    setDraftName(face.name);
    setDraftTitle(face.title ?? '');
    setDraftDescription(face.description ?? '');
    setEditing(true);
  };

  const canEditMemory = (m: MemoryObject): boolean => {
    // Patient can only edit their own `manual` memories.
    return m.source === 'manual' && m.created_by_user_id === me.user_id;
  };

  const handleEditMemory = (m: MemoryObject): void => {
    setEditingMemoryId(m.memory_id);
    setEditingMemoryContent(m.content);
  };

  const handleDeleteMemory = (m: MemoryObject): void => {
    deleteMemoryMut.mutate(m.memory_id);
  };

  const memories = memoriesQuery.data?.memories ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="The people in your life."
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px' }}
      >
        {/* Back link */}
        <button
          type="button"
          onClick={() => navigate('/patient/faces')}
          className="font-label uppercase text-tertiary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            padding: '4px 0',
            marginBottom: 24,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          ← My People
        </button>

        {/* Face header block */}
        {!face ? (
          <p
            className="font-body text-tertiary"
            style={{ fontSize: 16, padding: '24px 0' }}
          >
            {facesQuery.isLoading ? 'Loading…' : 'Person not found.'}
          </p>
        ) : (
          <section style={{ paddingBottom: 32 }}>
            {editing ? (
              <div className="flex flex-col" style={{ gap: 12, maxWidth: '62ch' }}>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="font-headline text-on-surface"
                  style={{
                    fontSize: 48,
                    fontWeight: 600,
                    letterSpacing: '-0.03em',
                    lineHeight: 1.05,
                    border: '1px solid var(--outline-variant)',
                    background: 'var(--bg-surface-container-lowest)',
                    padding: '8px 12px',
                    borderRadius: 2,
                    color: 'var(--on-surface)',
                  }}
                  aria-label="Name"
                  maxLength={80}
                />
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="title (e.g. daughter)"
                  className="font-body text-tertiary"
                  style={{
                    fontSize: 24,
                    border: '1px solid var(--outline-variant)',
                    background: 'var(--bg-surface-container-lowest)',
                    padding: '8px 12px',
                    borderRadius: 2,
                    color: 'var(--tertiary)',
                  }}
                  aria-label="Title"
                  maxLength={40}
                />
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="description"
                  className="font-body text-on-surface"
                  style={{
                    fontSize: 18,
                    lineHeight: 1.5,
                    border: '1px solid var(--outline-variant)',
                    background: 'var(--bg-surface-container-lowest)',
                    padding: '10px 12px',
                    borderRadius: 2,
                    minHeight: 80,
                    color: 'var(--on-surface)',
                    resize: 'vertical',
                  }}
                  aria-label="Description"
                  maxLength={500}
                />
              </div>
            ) : (
              <>
                <h2
                  className="font-headline text-on-surface"
                  style={{
                    fontSize: 48,
                    fontWeight: 600,
                    letterSpacing: '-0.03em',
                    lineHeight: 1.05,
                    margin: 0,
                  }}
                >
                  {face.name}
                </h2>
                {face.title ? (
                  <p
                    className="font-body text-tertiary"
                    style={{
                      fontSize: 24,
                      lineHeight: 1.35,
                      marginTop: 6,
                    }}
                  >
                    {face.title}
                  </p>
                ) : null}
                {face.description ? (
                  <p
                    className="font-body text-on-surface"
                    style={{
                      fontSize: 18,
                      lineHeight: 1.55,
                      marginTop: 16,
                      maxWidth: '62ch',
                    }}
                  >
                    {face.description}
                  </p>
                ) : null}
              </>
            )}
          </section>
        )}

        {/* Memories section */}
        <section>
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
              Memories
            </span>
            {!addingMemory ? (
              <button
                type="button"
                onClick={() => setAddingMemory(true)}
                className="font-headline uppercase text-on-surface"
                style={{
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  padding: '6px 12px',
                  border: '1px solid var(--on-surface)',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                Add memory
              </button>
            ) : null}
          </div>

          {addingMemory ? (
            <div
              className="flex flex-col"
              style={{
                gap: 10,
                padding: '16px 0 20px',
                borderBottom: '1px solid var(--outline-variant)',
              }}
            >
              <textarea
                value={newMemoryContent}
                onChange={(e) => setNewMemoryContent(e.target.value.slice(0, MEMORY_MAX))}
                placeholder="A short note to remember…"
                className="font-body text-on-surface"
                style={{
                  fontSize: 18,
                  lineHeight: 1.55,
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--bg-surface-container-lowest)',
                  padding: '10px 12px',
                  borderRadius: 2,
                  minHeight: 96,
                  color: 'var(--on-surface)',
                  resize: 'vertical',
                }}
                aria-label="New memory content"
              />
              <div className="flex items-center justify-between">
                <span
                  className="font-label text-tertiary"
                  style={{ fontSize: 11, letterSpacing: '0.08em' }}
                >
                  {newMemoryContent.length} / {MEMORY_MAX}
                </span>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingMemory(false);
                      setNewMemoryContent('');
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
                    onClick={() => createMemoryMut.mutate()}
                    disabled={createMemoryMut.isPending || !newMemoryContent.trim()}
                    className="font-headline uppercase"
                    style={{
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      padding: '6px 12px',
                      border: '1px solid var(--accent)',
                      backgroundColor: 'var(--accent)',
                      color: 'var(--on-primary)',
                      cursor: createMemoryMut.isPending ? 'not-allowed' : 'pointer',
                      borderRadius: 2,
                      opacity: createMemoryMut.isPending ? 0.6 : 1,
                    }}
                  >
                    Save memory
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Inline-editing one memory */}
          {editingMemoryId ? (
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
                style={{ fontSize: 11, letterSpacing: '0.12em' }}
              >
                Editing memory
              </div>
              <textarea
                value={editingMemoryContent}
                onChange={(e) =>
                  setEditingMemoryContent(e.target.value.slice(0, MEMORY_MAX))
                }
                className="font-body text-on-surface"
                style={{
                  fontSize: 18,
                  lineHeight: 1.55,
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--bg-surface-container-lowest)',
                  padding: '10px 12px',
                  borderRadius: 2,
                  minHeight: 96,
                  color: 'var(--on-surface)',
                  resize: 'vertical',
                }}
                aria-label="Edit memory content"
              />
              <div className="flex items-center justify-between">
                <span
                  className="font-label text-tertiary"
                  style={{ fontSize: 11, letterSpacing: '0.08em' }}
                >
                  {editingMemoryContent.length} / {MEMORY_MAX}
                </span>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMemoryId(null);
                      setEditingMemoryContent('');
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
                    onClick={() => updateMemoryMut.mutate()}
                    disabled={
                      updateMemoryMut.isPending || !editingMemoryContent.trim()
                    }
                    className="font-headline uppercase"
                    style={{
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      padding: '6px 12px',
                      border: '1px solid var(--accent)',
                      backgroundColor: 'var(--accent)',
                      color: 'var(--on-primary)',
                      cursor: updateMemoryMut.isPending ? 'not-allowed' : 'pointer',
                      borderRadius: 2,
                      opacity: updateMemoryMut.isPending ? 0.6 : 1,
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <MemoryList
            memories={memories}
            canEdit={canEditMemory}
            onEdit={handleEditMemory}
            onDelete={handleDeleteMemory}
          />
        </section>

        {/* Edit Mode toggle for face fields */}
        {face ? (
          <EditModeToggle
            editing={editing}
            onToggle={handleToggleEdit}
            onCancel={() => setEditing(false)}
            onSave={() => updateFaceMut.mutate()}
          />
        ) : null}
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
