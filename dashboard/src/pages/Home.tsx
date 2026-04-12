/**
 * Home — portal selector (FRONTEND_SPEC §2.5, frontend.mdc §6.4).
 *
 * First impression of the product: a layered cream→parchment vertical wash
 * carries warmth, a subtle noise overlay lives on body::before, and the two
 * portal zones feel like distinct editorial moments rather than twin buttons.
 *
 * Behavior:
 *   - If already authenticated, redirect to the role's portal.
 *   - Click "Patient Portal":
 *       * dev bypass: login('patient') + navigate('/patient')
 *       * real Auth0: login('patient') (redirects away)
 *   - Same for Caregiver Portal.
 *
 * Typography:
 *   - App lockup top-left: Fraunces 40px title + Newsreader 16px tagline.
 *   - Footer: JetBrains Mono 11px, --ink-secondary.
 */

import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { PortalHomeCard } from '../components/PortalHomeCard';
import { useAppAuth } from '../auth/useAppAuth';
import { useMe } from '../auth/useMe';
import { DEV_AUTH_BYPASS } from '../auth/AuthProvider';
import type { Role } from '../types/api';

function portalPath(role: Role): string {
  return role === 'patient' ? '/patient' : '/caretaker';
}

export function HomePage(): ReactElement {
  const auth = useAppAuth();
  const { me } = useMe();
  const navigate = useNavigate();

  // Already signed in — send them to their portal.
  useEffect(() => {
    if (me) {
      navigate(portalPath(me.role), { replace: true });
    }
  }, [me, navigate]);

  const handlePortalClick = (role: Role): void => {
    // Dev bypass: synchronous; then navigate. The `useMe` effect above also
    // catches this on re-render once `me` resolves, but navigating eagerly
    // keeps the interaction snappy.
    if (DEV_AUTH_BYPASS) {
      auth.login(role);
      navigate(portalPath(role));
      return;
    }
    // Real Auth0: stash hint + redirect. AuthProvider.login handles the
    // `loginWithRedirect({ appState: { target } })` contract.
    auth.login(role);
  };

  return (
    <div
      className="relative flex min-h-full w-full flex-col"
      style={{
        // Layered vertical wash: --bg-sunken at the top settling into
        // --bg-base lower, evoking parchment lit from above.
        backgroundImage:
          'linear-gradient(180deg, var(--bg-sunken) 0%, var(--bg-base) 55%, var(--bg-base) 100%)',
      }}
    >
      {/* App lockup — top-left editorial masthead */}
      <div
        className="flex flex-col"
        style={{ padding: '48px 64px 0 64px' }}
      >
        <span
          className="font-display text-ink-primary"
          style={{
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          RememberMe
        </span>
        <span
          className="font-text text-ink-secondary"
          style={{
            fontSize: 16,
            lineHeight: 1.5,
            marginTop: 8,
            maxWidth: 420,
          }}
        >
          Memory support, gently.
        </span>
      </div>

      {/* Centered portal picker */}
      <main
        className="flex flex-1 items-center justify-center"
        style={{ padding: '48px 64px' }}
      >
        <div style={{ width: '100%', maxWidth: 1120 }}>
          <PortalHomeCard
            onPatientClick={() => handlePortalClick('patient')}
            onCaretakerClick={() => handlePortalClick('caretaker')}
          />
        </div>
      </main>

      {/* Footer — hairline + tiny version/license in mono */}
      <footer
        className="flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--rule)',
          padding: '16px 64px',
        }}
      >
        <span
          className="font-mono uppercase text-ink-secondary"
          style={{ fontSize: 11, letterSpacing: '0.14em' }}
        >
          v0.1.0 · hackathon build
        </span>
        <span
          className="font-mono uppercase text-ink-secondary"
          style={{ fontSize: 11, letterSpacing: '0.14em' }}
        >
          assistive software · built with care
        </span>
      </footer>
    </div>
  );
}
