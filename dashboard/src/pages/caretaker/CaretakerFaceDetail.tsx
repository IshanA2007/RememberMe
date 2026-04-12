/**
 * CaretakerFaceDetail — `/caretaker/:patient_id/faces/:face_id`.
 *
 * Same shape as patient FaceDetail, but caretaker has wider authority:
 *   - may create `caretaker` memories
 *   - may edit/delete ANY memory (including `conversation`)
 *   - may delete the face (with inline confirmation — NO modals)
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
  deleteFace,
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

export function CaretakerFaceDetailPage(): ReactElement {
  const { me } = useMe();
  const { patient_id, face_id } = useParams<{
    patient_id: string;
    face_id: string;
  }>();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();
  const auth = useAppAuth();
  const qc = useQueryClient();

  const facesQuery = useQuery<FaceListResponse>({
    queryKey: ['faces', patient_id],
    enabled: Boolean(patient_id),
    staleTime: 15_000,
    queryFn: () => listFaces(fetcher, patient_id as string),
  });

  const memoriesQuery = useQuery<MemoryListResponse>({
    queryKey: ['memories', face_id],
    enabled: Boolean(face_id),
    staleTime: 15_000,
    queryFn: () => listMemories(fetcher, face_id as string),
  });

  const face: FaceObject | undefined = useMemo(
    () => facesQuery.data?.faces.find((f) => f.face_id === face_id),
    [facesQuery.data, face_id],
  );

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState('');

  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');

  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
      void qc.invalidateQueries({ queryKey: ['faces', patient_id] });
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
        source: 'caretaker',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memories', face_id] });
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
      void qc.invalidateQueries({ queryKey: ['memories', face_id] });
      setEditingMemoryId(null);
      setEditingMemoryContent('');
    },
  });

  const deleteMemoryMut = useMutation({
    mutationFn: async (memoryId: string): Promise<void> => {
      await deleteMemory(fetcher, memoryId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memories', face_id] });
    },
  });

  const deleteFaceMut = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!face) throw new Error('Face not loaded');
      await deleteFace(fetcher, face.face_id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['faces', patient_id] });
      navigate(`/caretaker/${patient_id}/faces`);
    },
  });

  if (!me || !patient_id || !face_id) return <div />;

  const handleToggleEdit = (): void => {
    if (!face) return;
    setDraftName(face.name);
    setDraftTitle(face.title ?? '');
    setDraftDescription(face.description ?? '');
    setEditing(true);
  };

  // Caretaker has authority over every memory.
  const canEditMemory = (_m: MemoryObject): boolean => true;

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
        role="caretaker"
        name={face?.name ?? 'Face'}
        description="Caretaker view · Edit this person's details and memories."
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px' }}
      >
        <button
          type="button"
          onClick={() => navigate(`/caretaker/${patient_id}/faces`)}
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
          ← People
        </button>

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
                  placeholder="title"
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
                    style={{ fontSize: 24, lineHeight: 1.35, marginTop: 6 }}
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
                onChange={(e) =>
                  setNewMemoryContent(e.target.value.slice(0, MEMORY_MAX))
                }
                placeholder="Add context that helps recognition…"
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
                    disabled={
                      createMemoryMut.isPending || !newMemoryContent.trim()
                    }
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

        {face ? (
          <EditModeToggle
            editing={editing}
            onToggle={handleToggleEdit}
            onCancel={() => setEditing(false)}
            onSave={() => updateFaceMut.mutate()}
          />
        ) : null}

        {/* Delete face zone (inline confirm — no modals) */}
        {face ? (
          <section
            style={{
              marginTop: 24,
              padding: '20px 0',
              borderTop: '1px solid var(--outline-variant)',
            }}
          >
            <div
              className="font-label uppercase text-tertiary"
              style={{
                fontSize: 11,
                letterSpacing: '0.14em',
                paddingBottom: 10,
              }}
            >
              Danger zone
            </div>
            {!confirmingDelete ? (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="font-headline uppercase text-tertiary"
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    padding: '8px 14px',
                    border: '1px solid var(--outline-variant)',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  Delete this person
                </button>
              </div>
            ) : (
              <div
                className="flex flex-col"
                style={{
                  gap: 12,
                  padding: '12px 0',
                }}
              >
                <p
                  className="font-body text-on-surface"
                  style={{ fontSize: 16, lineHeight: 1.5, margin: 0 }}
                >
                  Delete this person and all their memories? This cannot be
                  undone.
                </p>
                <div className="flex items-center justify-end" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
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
                    onClick={() => deleteFaceMut.mutate()}
                    disabled={deleteFaceMut.isPending}
                    className="font-headline uppercase"
                    style={{
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      padding: '6px 12px',
                      border: '1px solid var(--signal-warm)',
                      backgroundColor: 'var(--signal-warm)',
                      color: 'var(--on-primary)',
                      cursor: deleteFaceMut.isPending ? 'not-allowed' : 'pointer',
                      borderRadius: 2,
                      opacity: deleteFaceMut.isPending ? 0.6 : 1,
                    }}
                  >
                    Yes, delete
                  </button>
                </div>
              </div>
            )}
          </section>
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
