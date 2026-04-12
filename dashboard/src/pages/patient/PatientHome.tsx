/**
 * PatientHome — `/patient` sidebar layout with nav, hero greeting, action cards.
 *
 * Design:
 *   - Fixed left sidebar (64px top offset) with nav items, logout
 *   - Main content: hero greeting, two bento action cards
 *   - Right sidebar: recent memories + next reminder
 *   - Bottom: floating action button for editing reminders
 *   - Entrance animations: header + cards staggered
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { LayoutDashboard, Users, Bell, Settings, LogOut, CheckCircle } from 'lucide-react';

import { Header } from '../../components/Header';
import { useAuthedFetch } from '../../auth/useAuthedFetch';
import { useAppAuth } from '../../auth/useAppAuth';
import { useMe } from '../../auth/useMe';
import { getQuickInfo } from '../../services/rest_client';
import type { QuickInfoResponse } from '../../types/api';

const VISION_URL: string =
  (import.meta.env.VITE_VISION_URL as string | undefined) ?? 'http://localhost:3001';

function formatOverlineDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} · ${hh}:${mm}`;
}

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

interface ActionCardProps {
  icon: ReactElement;
  title: string;
  description: string;
  onClick: () => void;
  bgColor: string;
  textColor: string;
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  bgColor,
  textColor,
}: ActionCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full p-8 rounded-[2rem] text-left transition-all duration-300 border-none cursor-pointer group"
      style={{
        background: bgColor,
        color: textColor,
        animation: 'slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          fontSize: 40,
          marginBottom: 16,
          opacity: 0.9,
        }}
      >
        {icon}
      </div>
      <h3
        className="font-headline font-extrabold mb-2"
        style={{ fontSize: 20, margin: 0 }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 14, margin: 0, opacity: 0.85 }}>
        {description}
      </p>
    </button>
  );
}

export function PatientHomePage(): ReactElement {
  const auth = useAppAuth();
  const { me } = useMe();
  const navigate = useNavigate();
  const fetcher = useAuthedFetch();

  const patientId = me?.user_id ?? '';

  const { data: quickInfo } = useQuery<QuickInfoResponse>({
    queryKey: ['quick-info', patientId],
    enabled: Boolean(patientId),
    staleTime: 60_000,
    queryFn: () => getQuickInfo(fetcher, patientId),
  });

  if (!me) return <div />;

  const handleLaunchVision = async (): Promise<void> => {
    const token = await auth.getAccessToken();
    const url =
      `${VISION_URL.replace(/\/+$/, '')}/?token=${encodeURIComponent(token)}` +
      `&patient_id=${encodeURIComponent(patientId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleLogout = (): void => {
    auth.logout();
  };

  const recent = quickInfo?.recent_memories.slice(0, 3) ?? [];
  const nextReminder = quickInfo?.upcoming_reminders[0];

  return (
    <div className="min-h-full flex flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="Welcome back"
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
              isActive={true}
              onClick={() => {}}
            />
            <NavItem
              label="My People"
              icon={<Users size={20} />}
              onClick={() => navigate('/patient/faces')}
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
        <main className="flex-1 md:ml-64 p-6 md:p-8 pb-32">
          <div className="max-w-6xl mx-auto">
            {/* Hero greeting */}
            <header
              className="mb-12"
              style={{
                animation: 'slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <h1
                className="font-headline font-extrabold text-on-surface tracking-tight mb-2"
                style={{ fontSize: 40 }}
              >
                Good morning, {me.display_name}
              </h1>
              <p className="text-tertiary text-lg">
                Here's your daily care summary and upcoming reminders.
              </p>
            </header>

            {/* Two-column grid: Action cards + Launch Vision | Sidebar */}
            <div
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
              style={{
                alignItems: 'start',
              }}
            >
              {/* Left: Action cards */}
              <section className="lg:col-span-8 flex flex-col gap-6">
                {/* Action Cards Bento */}
                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-6"
                  style={{
                    animation: 'slideUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    animationDelay: '0.1s',
                  }}
                >
                  <ActionCard
                    icon={<Users size={32} />}
                    title="My People"
                    description="View and manage your family circle and trusted faces."
                    onClick={() => navigate('/patient/faces')}
                    bgColor="var(--tertiary-fixed)"
                    textColor="var(--on-tertiary-fixed)"
                  />
                  <ActionCard
                    icon={<Bell size={32} />}
                    title="Reminders & Lists"
                    description="Check today's medications, appointments, and tasks."
                    onClick={() => navigate('/patient/reminders')}
                    bgColor="var(--secondary-container)"
                    textColor="var(--on-secondary-container)"
                  />
                </div>

                {/* Launch Vision Button */}
                <button
                  type="button"
                  onClick={() => {
                    void handleLaunchVision();
                  }}
                  className="w-full py-4 px-6 rounded-xl font-headline font-bold text-on-primary transition-all duration-300"
                  style={{
                    background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-container) 100%)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 16,
                    animation: 'slideUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    animationDelay: '0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 109, 48, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  ✨ Launch Vision App
                </button>
              </section>

              {/* Right: Recent memories + Next reminder */}
              <aside className="lg:col-span-4 flex flex-col gap-6">
                {/* Recent memories card */}
                <div
                  className="rounded-[2rem] p-8"
                  style={{
                    background: 'var(--surface-container-low)',
                    animation: 'slideUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    animationDelay: '0.15s',
                  }}
                >
                  <h3
                    className="font-headline font-bold text-on-surface mb-6"
                    style={{ fontSize: 18, margin: 0 }}
                  >
                    Recent Memories
                  </h3>

                  {recent.length === 0 ? (
                    <p className="text-tertiary text-sm">
                      No recent memories yet. Memories will appear here as they're added.
                    </p>
                  ) : (
                    <ul
                      className="flex flex-col"
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        gap: 16,
                      }}
                    >
                      {recent.map((m) => (
                        <li
                          key={m.memory_id}
                          style={{
                            paddingBottom: 16,
                            borderBottom: '1px solid var(--surface-container)',
                          }}
                        >
                          <div
                            className="text-tertiary text-xs uppercase tracking-widest font-label mb-2"
                            style={{ letterSpacing: '0.1em' }}
                          >
                            {formatOverlineDate(m.created_at)} · {m.face_name}
                          </div>
                          <p
                            className="text-on-surface font-body"
                            style={{
                              fontSize: 14,
                              lineHeight: 1.5,
                              margin: 0,
                            }}
                          >
                            {m.content}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Next reminder card */}
                <div
                  className="rounded-[2rem] p-8"
                  style={{
                    background: 'var(--primary-container)',
                    color: 'white',
                    animation: 'slideUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    animationDelay: '0.25s',
                  }}
                >
                  <h3
                    className="font-headline font-bold mb-6"
                    style={{ fontSize: 18, margin: 0 }}
                  >
                    Next Reminder
                  </h3>

                  {nextReminder ? (
                    <div>
                      <div
                        className="text-white/70 text-xs uppercase tracking-widest font-label mb-2"
                        style={{ letterSpacing: '0.1em' }}
                      >
                        {formatOverlineDate(nextReminder.trigger_at)}
                      </div>
                      <div
                        className="font-headline font-bold"
                        style={{
                          fontSize: 20,
                          lineHeight: 1.2,
                          margin: 0,
                        }}
                      >
                        {nextReminder.title}
                      </div>
                      <div
                        className="mt-6 flex items-center gap-2"
                        style={{
                          opacity: 0.9,
                          fontSize: 14,
                        }}
                      >
                        <CheckCircle size={18} />
                        <span>You'll get a reminder at the scheduled time</span>
                      </div>
                    </div>
                  ) : (
                    <p
                      className="text-white/80 text-sm"
                      style={{ margin: 0 }}
                    >
                      No upcoming reminders scheduled right now.
                    </p>
                  )}
                </div>
              </aside>
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
          onClick={() => navigate('/patient')}
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
          Home
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
