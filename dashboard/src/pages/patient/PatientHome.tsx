/**
 * PatientHome — `/patient` (FRONTEND_SPEC §2.3, frontend.mdc §6.2).
 *
 * Two asymmetric island links (NOT a hero-card grid) — "My People" and
 * "Reminders & Lists" — plus a prominent "Launch Vision" action and a small
 * editorial side column with RECENT / NEXT running heads.
 *
 * Bottom-left Home (disabled on home), bottom-right Logout.
 *
 * Data:
 *   - useMe() → name + description (description kept short/warm, per copy rules)
 *   - useQuery on /api/patients/{id}/quick-info (stale 60s per §2.7)
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';

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
        padding: '48px 16px',
        minHeight: 240,
      }}
    >
      <span
        className="font-display"
        style={{
          fontSize: 56,
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

interface BottomBarProps {
  onLogout: () => void;
}

function BottomBar({ onLogout }: BottomBarProps): ReactElement {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '16px 40px',
      }}
    >
      <button
        type="button"
        disabled
        className="font-display uppercase text-ink-secondary"
        style={{
          fontSize: 14,
          letterSpacing: '0.14em',
          padding: '10px 16px',
          border: '1px solid var(--rule)',
          background: 'transparent',
          cursor: 'not-allowed',
          opacity: 0.5,
          borderRadius: 2,
        }}
        aria-disabled
      >
        Home
      </button>
      <button
        type="button"
        onClick={onLogout}
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
    <div className="flex min-h-full flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="Welcome home."
      />

      <main
        className="flex-1"
        style={{ padding: '48px 40px' }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'minmax(0, 1.7fr) 1px minmax(0, 1fr)',
            gap: 48,
            alignItems: 'start',
          }}
        >
          {/* Primary: asymmetric island links + launch vision */}
          <div className="flex flex-col" style={{ gap: 24 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: 0,
                borderTop: '1px solid var(--rule)',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <IslandLink
                title="My People"
                tagline="The people in your life."
                onClick={() => navigate('/patient/faces')}
                align="left"
              />
              <div
                aria-hidden
                style={{ height: 1, backgroundColor: 'var(--rule)' }}
              />
              <IslandLink
                title="Reminders & Lists"
                tagline="Today and the days ahead."
                onClick={() => navigate('/patient/reminders')}
                align="right"
              />
            </div>

            <div
              className="flex items-center"
              style={{ gap: 16, paddingTop: 16 }}
            >
              <button
                type="button"
                onClick={() => {
                  void handleLaunchVision();
                }}
                className="font-display"
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  padding: '16px 28px',
                  border: '1px solid var(--accent)',
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  cursor: 'pointer',
                  borderRadius: 2,
                  lineHeight: 1,
                }}
              >
                Launch Vision
              </button>
              <span
                className="font-text text-ink-secondary"
                style={{ fontSize: 14, maxWidth: 320 }}
              >
                Opens the camera view in a new window.
              </span>
            </div>
          </div>

          {/* Vertical rule */}
          <div
            aria-hidden
            style={{ width: 1, backgroundColor: 'var(--rule)', alignSelf: 'stretch' }}
          />

          {/* Side editorial column: RECENT / NEXT */}
          <aside className="flex flex-col" style={{ gap: 32 }}>
            <section>
              <div
                className="font-mono uppercase text-ink-secondary"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                Recent
              </div>
              {recent.length === 0 ? (
                <p
                  className="font-text text-ink-secondary"
                  style={{ fontSize: 14, paddingTop: 16 }}
                >
                  No recent memories yet.
                </p>
              ) : (
                <ul
                  className="flex flex-col"
                  style={{ listStyle: 'none', padding: 0, margin: 0 }}
                >
                  {recent.map((m) => (
                    <li
                      key={m.memory_id}
                      style={{
                        padding: '14px 0',
                        borderBottom: '1px solid var(--rule)',
                      }}
                    >
                      <div
                        className="font-mono uppercase text-ink-secondary"
                        style={{ fontSize: 11, letterSpacing: '0.1em' }}
                      >
                        {formatOverlineDate(m.created_at)} · {m.face_name}
                      </div>
                      <p
                        className="font-text text-ink-primary"
                        style={{
                          fontSize: 16,
                          lineHeight: 1.5,
                          marginTop: 4,
                        }}
                      >
                        {m.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div
                className="font-mono uppercase text-ink-secondary"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                Next
              </div>
              {nextReminder ? (
                <div style={{ padding: '14px 0' }}>
                  <div
                    className="font-mono uppercase text-ink-secondary"
                    style={{ fontSize: 11, letterSpacing: '0.1em' }}
                  >
                    {formatOverlineDate(nextReminder.trigger_at)}
                  </div>
                  <div
                    className="font-display text-ink-primary"
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      letterSpacing: '-0.02em',
                      marginTop: 4,
                      lineHeight: 1.15,
                    }}
                  >
                    {nextReminder.title}
                  </div>
                </div>
              ) : (
                <p
                  className="font-text text-ink-secondary"
                  style={{ fontSize: 14, paddingTop: 16 }}
                >
                  Nothing scheduled right now.
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>

      <BottomBar onLogout={handleLogout} />
    </div>
  );
}
