/**
 * PatientSettingsPage — `/patient/settings`.
 *
 * Minimal profile surface for hackathon scope:
 *   - Display name (read-only)
 *   - Email (read-only, may be null)
 *   - Logout
 *   - External link to the Auth0 tenant for account/password changes
 */

import { useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';

import { Header } from '../../components/Header';
import { useAppAuth } from '../../auth/useAppAuth';
import { useMe } from '../../auth/useMe';

const AUTH0_DOMAIN: string =
  (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined) ?? '';

interface FieldProps {
  label: string;
  value: string;
}

function Field({ label, value }: FieldProps): ReactElement {
  return (
    <div
      className="flex flex-col"
      style={{
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span
        className="font-mono uppercase text-ink-secondary"
        style={{ fontSize: 11, letterSpacing: '0.14em' }}
      >
        {label}
      </span>
      <span
        className="font-display text-ink-primary"
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          marginTop: 4,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function PatientSettingsPage(): ReactElement {
  const { me } = useMe();
  const auth = useAppAuth();
  const navigate = useNavigate();

  if (!me) return <div />;

  const tenantUrl = AUTH0_DOMAIN ? `https://${AUTH0_DOMAIN}` : null;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        role="patient"
        name={me.display_name}
        description="Your account."
      />

      <main
        className="flex-1"
        style={{ padding: '40px 40px 16px', maxWidth: 720 }}
      >
        <div
          className="font-mono uppercase text-ink-secondary"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            paddingBottom: 10,
            borderBottom: '1px solid var(--rule)',
          }}
        >
          Profile
        </div>

        <Field label="Display name" value={me.display_name} />
        <Field label="Email" value={me.email ?? '—'} />
        <Field label="Role" value={me.role} />

        {tenantUrl ? (
          <div style={{ paddingTop: 24 }}>
            <a
              href={tenantUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-text text-ink-primary"
              style={{
                fontSize: 16,
                textDecoration: 'underline',
                textDecorationColor: 'var(--accent)',
                textUnderlineOffset: 4,
              }}
            >
              Manage account on Auth0 ↗
            </a>
          </div>
        ) : null}
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
