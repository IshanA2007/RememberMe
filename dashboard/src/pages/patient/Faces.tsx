/**
 * PatientFacesPage — `/patient/faces` faces tree visualization.
 *
 * MemoryTree centered on the patient's name with face nodes arranged radially.
 * Face nodes are clickable and route to `/patient/faces/:id`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, type ReactElement } from 'react';
import {
  LayoutDashboard,
  Users,
  Bell,
  Settings,
  LogOut,
  ChevronLeft,
  UserPlus,
} from 'lucide-react';

import { Header } from '../../components/Header';
import { MemoryTree } from '../../components/MemoryTree';
import { PendingFacesSection } from '../../components/PendingFacesSection';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import { createFace, listFaces } from '../../services/rest_client';
import type {
  FaceCreateRequest,
  FaceListResponse,
  FaceObject,
} from '../../types/api';

const NAME_MAX = 80;
const TITLE_MAX = 40;
const DESCRIPTION_MAX = 500;

interface NavItemProps {
  label: string;
  icon: ReactElement;
  isActive?: boolean;
  onClick: () => void;
}

function NavItem({ label, icon, isActive, onClick }: NavItemProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200"
      style={{
        background: isActive ? 'var(--primary)' : 'transparent',
        color: isActive ? 'white' : 'var(--tertiary)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 14,
        fontFamily: 'var(--font-headline)',
        fontWeight: isActive ? 600 : 500,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--surface-container-low)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function PatientFacesPage(): ReactElement {
  const { me } = useMe();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();
  const auth = useAppAuth();
  const qc = useQueryClient();

  const patientId = me?.user_id ?? '';

  const { data, isLoading, error } = useQuery<FaceListResponse>({
    queryKey: ['faces', patientId],
    enabled: Boolean(patientId),
    staleTime: 15_000,
    queryFn: () => listFaces(fetcher, patientId),
  });

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const createMut = useMutation({
    mutationFn: async (): Promise<FaceObject> => {
      if (!patientId) throw new Error('No patient');
      if (!newName.trim()) throw new Error('Name is required');
      const body: FaceCreateRequest = {
        name: newName.trim(),
        title: newTitle.trim() ? newTitle.trim() : null,
        description: newDescription.trim() ? newDescription.trim() : null,
      };
      return createFace(fetcher, patientId, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['faces', patientId] });
      setAdding(false);
      setNewName('');
      setNewTitle('');
      setNewDescription('');
    },
  });

  const cancelAdd = (): void => {
    setAdding(false);
    setNewName('');
    setNewTitle('');
    setNewDescription('');
  };

  if (!me) return <div />;

  const faces: FaceObject[] = data?.faces ?? [];

  return (
    <div className="min-h-full flex flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="The people in your life"
      />

      <div className="flex flex-1 pt-20">
        {/* Left Sidebar Navigation */}
        <aside
          className="hidden md:flex fixed left-0 top-0 h-screen w-64 flex-col p-4 z-40 mt-20"
          style={{
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-container-low) 100%)',
            borderRight: '1px solid var(--outline-variant)',
          }}
        >
          {/* Brand pill in sidebar */}
          <div
            className="mb-8 px-4 pb-6"
            style={{
              borderBottom: '1px solid var(--outline-variant)',
            }}
          >
            <h2
              className="font-headline text-primary font-bold"
              style={{ fontSize: 18, margin: 0 }}
            >
              RememberMe
            </h2>
            <p
              className="text-tertiary text-xs uppercase tracking-widest font-label mt-1"
              style={{ margin: 0, letterSpacing: '0.15em' }}
            >
              Patient Portal
            </p>
          </div>

          {/* Nav items */}
          <nav className="flex flex-col gap-2 flex-1">
            <NavItem
              label="Dashboard"
              icon={<LayoutDashboard size={20} />}
              onClick={() => navigate('/patient')}
            />
            <NavItem
              label="My People"
              icon={<Users size={20} />}
              isActive={true}
              onClick={() => {}}
            />
            <NavItem
              label="Reminders"
              icon={<Bell size={20} />}
              onClick={() => navigate('/patient/reminders')}
            />
            <NavItem
              label="Settings"
              icon={<Settings size={20} />}
              onClick={() => navigate('/patient/settings')}
            />
          </nav>

          {/* Logout button */}
          <button
            type="button"
            onClick={() => auth.logout()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
            style={{
              background: 'transparent',
              color: 'var(--tertiary)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'var(--font-headline)',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--error-container)';
              e.currentTarget.style.color = 'var(--error)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--tertiary)';
            }}
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 md:ml-64 p-6 md:p-8 pb-32">
          <div className="w-full max-w-6xl mx-auto">
            {/* Hero header */}
            <header
              className="mb-8 flex items-start justify-between gap-6 flex-wrap"
              style={{
                animation: 'slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <div>
                <h1
                  className="font-headline font-extrabold text-on-surface tracking-tight mb-2"
                  style={{ fontSize: 36 }}
                >
                  My People
                </h1>
                <p className="text-tertiary text-lg">Family and friends in your life.</p>
              </div>
              {!adding ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-2 font-headline transition-all"
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    padding: '12px 20px',
                    borderRadius: 16,
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <UserPlus size={18} />
                  Add a person
                </button>
              ) : null}
            </header>

            {/* Inline add-person form */}
            {adding ? (
              <section
                className="mb-6 rounded-[2rem] p-6"
                style={{
                  background: 'var(--surface-container-low)',
                  border: '1px solid var(--outline-variant)',
                  animation: 'slideUp 0.3s ease',
                }}
              >
                <div
                  className="font-label uppercase text-tertiary mb-3"
                  style={{ fontSize: 11, letterSpacing: '0.14em' }}
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
                      fontSize: 24,
                      fontWeight: 600,
                      border: '1px solid var(--outline-variant)',
                      background: 'var(--surface)',
                      padding: '10px 14px',
                      borderRadius: 12,
                      color: 'var(--on-surface)',
                    }}
                    aria-label="Name"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value.slice(0, TITLE_MAX))}
                    placeholder="Relationship (e.g. daughter, friend, doctor)"
                    className="font-body text-on-surface"
                    style={{
                      fontSize: 16,
                      border: '1px solid var(--outline-variant)',
                      background: 'var(--surface)',
                      padding: '10px 14px',
                      borderRadius: 12,
                      color: 'var(--on-surface)',
                    }}
                    aria-label="Relationship"
                  />
                  <textarea
                    value={newDescription}
                    onChange={(e) =>
                      setNewDescription(e.target.value.slice(0, DESCRIPTION_MAX))
                    }
                    placeholder="A note to help remember them (optional)"
                    className="font-body text-on-surface"
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      border: '1px solid var(--outline-variant)',
                      background: 'var(--surface)',
                      padding: '10px 14px',
                      borderRadius: 12,
                      minHeight: 80,
                      color: 'var(--on-surface)',
                      resize: 'vertical',
                    }}
                    aria-label="Description"
                  />
                  {createMut.isError ? (
                    <p
                      className="font-body"
                      style={{ color: 'var(--error)', fontSize: 13 }}
                    >
                      Could not save. Please try again.
                    </p>
                  ) : null}
                  <div className="flex items-center justify-end" style={{ gap: 8 }}>
                    <button
                      type="button"
                      onClick={cancelAdd}
                      className="font-headline text-tertiary"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '8px 16px',
                        border: '1px solid var(--outline-variant)',
                        background: 'transparent',
                        cursor: 'pointer',
                        borderRadius: 12,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => createMut.mutate()}
                      disabled={createMut.isPending || !newName.trim()}
                      className="font-headline"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '8px 16px',
                        border: 'none',
                        background: 'var(--primary)',
                        color: 'white',
                        cursor:
                          createMut.isPending || !newName.trim()
                            ? 'not-allowed'
                            : 'pointer',
                        borderRadius: 12,
                        opacity:
                          createMut.isPending || !newName.trim() ? 0.55 : 1,
                      }}
                    >
                      {createMut.isPending ? 'Saving…' : 'Save person'}
                    </button>
                  </div>
                </div>
                <p
                  className="font-body text-tertiary"
                  style={{ fontSize: 12, marginTop: 10, maxWidth: '62ch' }}
                >
                  Vision will capture this person's face the next time it
                  sees them. You can add more details or memories from their
                  page.
                </p>
              </section>
            ) : null}

            {/* Pending faces section */}
            {patientId ? (
              <div
                style={{
                  animation: 'slideUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  animationDelay: '0.1s',
                  marginBottom: 24,
                }}
              >
                <PendingFacesSection patientId={patientId} />
              </div>
            ) : null}

            {/* Memory tree or empty state */}
            {isLoading ? (
              <div
                className="rounded-[2rem] p-12 text-center"
                style={{
                  background: 'var(--surface-container-low)',
                  color: 'var(--tertiary)',
                }}
              >
                Loading your people...
              </div>
            ) : error ? (
              <div
                className="rounded-[2rem] p-12 text-center"
                style={{
                  background: 'var(--surface-container-low)',
                  color: 'var(--tertiary)',
                }}
              >
                Could not load your people. Please try again.
              </div>
            ) : faces.length === 0 ? (
              <div
                className="rounded-[2rem] p-12 text-center"
                style={{
                  background: 'var(--surface-container-low)',
                  maxWidth: '62ch',
                  margin: '0 auto',
                }}
              >
                <p
                  className="font-body text-tertiary text-lg"
                  style={{ margin: 0 }}
                >
                  No people have been added yet. A caregiver can add family and friends, and the Vision app will recognize them in person.
                </p>
              </div>
            ) : (
              <div
                style={{
                  width: '100%',
                  minHeight: 500,
                  height: 'clamp(500px, 65vh, 800px)',
                  animation: 'slideUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  animationDelay: '0.15s',
                }}
              >
                <MemoryTree
                  centerName={me.display_name}
                  faces={faces}
                  onFaceClick={(f) => navigate(`/patient/faces/${f.face_id}`)}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Bottom mobile nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-6 py-4"
        style={{
          background: 'rgba(245, 250, 250, 0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--outline-variant)',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/patient')}
          className="flex flex-col items-center gap-1"
          style={{
            background: 'transparent',
            color: 'var(--tertiary)',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-headline)',
            fontWeight: 600,
          }}
        >
          <ChevronLeft size={20} />
          Back
        </button>
        <button
          type="button"
          onClick={() => auth.logout()}
          className="flex flex-col items-center gap-1"
          style={{
            background: 'transparent',
            color: 'var(--tertiary)',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-headline)',
            fontWeight: 600,
          }}
        >
          <LogOut size={20} />
          Logout
        </button>
      </nav>
    </div>
  );
}
