/**
 * CaretakerHome — `/caretaker` caregiver portal landing.
 *
 * Fetches assigned patients. If exactly one, redirect to `/caretaker/{patient_id}`.
 * Otherwise render a designed patient selector with sidebar layout.
 *
 * Design: Sidebar nav + patient list cards in main area.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, LogOut, User } from 'lucide-react';

import { Header } from '../../components/Header';
import { PatientSelector } from '../../components/PatientSelector';
import { useAppAuth } from '../../auth/useAppAuth';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useMe } from '../../auth/useMe';
import { listPatients } from '../../services/rest_client';
import type { PatientDirectoryResponse } from '../../types/api';

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

  const handleLogout = (): void => {
    auth.logout();
  };

  return (
    <div className="min-h-full flex flex-col">
      <Header
        role="caretaker"
        name={me.display_name}
        description="Your care circle"
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
              Caregiver Portal
            </p>
          </div>

          {/* Nav items */}
          <nav className="flex flex-col gap-2 flex-1">
            <NavItem
              label="Patients"
              icon={<LayoutDashboard size={20} />}
              isActive={true}
              onClick={() => {}}
            />
            <NavItem
              label="Settings"
              icon={<Settings size={20} />}
              onClick={() => navigate('/caretaker/settings')}
            />
          </nav>

          {/* Logout button */}
          <button
            type="button"
            onClick={handleLogout}
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
            {/* Hero heading */}
            <header
              className="mb-8"
              style={{
                animation: 'slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <h1
                className="font-headline font-extrabold text-on-surface tracking-tight mb-2"
                style={{ fontSize: 40 }}
              >
                Your Patients
              </h1>
              <p className="text-tertiary text-lg">
                Access and manage patient information and memories.
              </p>
            </header>

            {/* Patient selector */}
            <div
              style={{
                animation: 'slideUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
                animationDelay: '0.1s',
              }}
            >
              {patients.length === 0 ? (
                <div
                  className="rounded-[2rem] p-12 text-center"
                  style={{
                    background: 'var(--surface-container-low)',
                  }}
                >
                  <User size={48} className="mx-auto mb-4 text-tertiary" />
                  <p
                    className="text-tertiary text-lg font-body"
                    style={{ maxWidth: '62ch', margin: '0 auto' }}
                  >
                    No patients are assigned to you yet. Contact your administrator to add patients to your care circle.
                  </p>
                </div>
              ) : (
                <PatientSelector
                  patients={patients}
                  onSelect={(id) => navigate(`/caretaker/${id}`)}
                />
              )}
            </div>
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
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-headline)',
            fontWeight: 600,
          }}
        >
          <LayoutDashboard size={20} />
          Patients
        </button>
        <button
          type="button"
          onClick={handleLogout}
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
