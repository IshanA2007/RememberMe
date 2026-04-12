/**
 * CaretakerPatientHome — `/caretaker/:patient_id` patient detail view.
 *
 * Shows activity feed and management actions for a specific patient.
 * Uses sidebar layout matching the caretaker portal design.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, Bell, LayoutDashboard, Settings, LogOut, ChevronLeft } from 'lucide-react';

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

interface NavItemProps {
  label: string;
  icon: ReactElement;
  onClick: () => void;
  isActive?: boolean;
}

function NavItem({ label, icon, onClick, isActive }: NavItemProps): ReactElement {
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

interface ActionCardProps {
  title: string;
  description: string;
  icon: ReactElement;
  onClick: () => void;
}

function ActionCard({ title, description, icon, onClick }: ActionCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full p-6 rounded-2xl transition-all duration-300 border-none cursor-pointer text-left"
      style={{
        background: 'var(--surface-container-low)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.12)';
        e.currentTarget.style.background = 'white';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.background = 'var(--surface-container-low)';
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <h3
        className="font-headline font-bold mb-1 text-on-surface"
        style={{ fontSize: 16, margin: 0 }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 14, margin: 0, color: 'var(--tertiary)' }}>
        {description}
      </p>
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
    <div className="min-h-full flex flex-col">
      <Header
        role="caretaker"
        name={patientName}
        description={me.display_name}
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
          {/* Back button + Patient name */}
          <div
            className="mb-8 px-4 pb-6"
            style={{
              borderBottom: '1px solid var(--outline-variant)',
            }}
          >
            <button
              type="button"
              onClick={() => navigate('/caretaker')}
              className="flex items-center gap-2 text-primary hover:opacity-70 transition-opacity font-headline font-semibold mb-3 bg-none border-none cursor-pointer p-0"
              style={{ fontSize: 14 }}
            >
              <ChevronLeft size={20} />
              Back
            </button>
            <h2
              className="font-headline text-on-surface font-bold"
              style={{ fontSize: 16, margin: 0 }}
            >
              {patientName}
            </h2>
          </div>

          {/* Nav items */}
          <nav className="flex flex-col gap-2 flex-1">
            <NavItem
              label="Activity"
              icon={<LayoutDashboard size={20} />}
              isActive={true}
              onClick={() => {}}
            />
            <NavItem
              label="People"
              icon={<Users size={20} />}
              onClick={() => navigate(`/caretaker/${patient_id}/faces`)}
            />
            <NavItem
              label="Reminders"
              icon={<Bell size={20} />}
              onClick={() => navigate(`/caretaker/${patient_id}/reminders`)}
            />
            <NavItem
              label="Settings"
              icon={<Settings size={20} />}
              onClick={() => navigate(`/caretaker/${patient_id}/settings`)}
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
        <main className="flex-1 md:ml-64 p-6 md:p-8">
          <div className="max-w-4xl mx-auto">
            {/* Hero header */}
            <header className="mb-8">
              <h1
                className="font-headline font-extrabold text-on-surface tracking-tight mb-2"
                style={{ fontSize: 36 }}
              >
                {patientName}'s Activity
              </h1>
              <p className="text-tertiary text-lg">Recent recognitions, conversations, and reminders.</p>
            </header>

            {/* Activity Feed */}
            {activityQuery.isLoading ? (
              <div
                className="rounded-[2rem] p-8 text-center"
                style={{
                  background: 'var(--surface-container-low)',
                  color: 'var(--tertiary)',
                }}
              >
                Loading activity...
              </div>
            ) : activityQuery.data ? (
              <ActivityFeed activity={activityQuery.data} />
            ) : (
              <div
                className="rounded-[2rem] p-8 text-center"
                style={{
                  background: 'var(--surface-container-low)',
                  color: 'var(--tertiary)',
                }}
              >
                Could not load activity for this patient.
              </div>
            )}

            {/* Management Actions */}
            <section className="mt-12">
              <h2
                className="font-headline font-bold text-on-surface mb-6"
                style={{ fontSize: 20 }}
              >
                Manage Patient
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ActionCard
                  title="Manage People"
                  description="Add, edit, and correct faces in this patient's life."
                  icon={<Users size={24} />}
                  onClick={() => navigate(`/caretaker/${patient_id}/faces`)}
                />
                <ActionCard
                  title="Manage Reminders"
                  description="Schedule medications, appointments, and daily cues."
                  icon={<Bell size={24} />}
                  onClick={() => navigate(`/caretaker/${patient_id}/reminders`)}
                />
              </div>
            </section>
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
          onClick={() => navigate('/caretaker')}
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
