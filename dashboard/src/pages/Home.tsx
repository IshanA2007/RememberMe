/**
 * Home — portal selector landing with glassmorphism card and organic backdrop.
 *
 * Design:
 *   - Full-bleed radial gradient background (soft greens)
 *   - Centered glassmorphism card with PortalHomeCard
 *   - Animated organic blobs floating behind
 *   - Subtle footer with branding
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
    if (DEV_AUTH_BYPASS) {
      sessionStorage.setItem('pending_role', role);
      auth.login(role);
      navigate(portalPath(role));
      return;
    }
    auth.login(role);
  };

  return (
    <div
      className="relative flex min-h-full w-full flex-col"
      style={{
        background:
          'radial-gradient(circle at 10% 20%, #f0fdf4 0%, transparent 40%), ' +
          'radial-gradient(circle at 90% 80%, #dcfce7 0%, transparent 40%), ' +
          'radial-gradient(circle at 50% 50%, #effaf3 0%, transparent 100%), ' +
          '#f7fdf9',
      }}
    >
      {/* Animated organic blobs behind card */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden z-0"
        style={{
          opacity: 0.4,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-200px',
            left: '-200px',
            width: '500px',
            height: '500px',
            background: 'rgba(0, 109, 48, 0.1)',
            borderRadius: '50%',
            filter: 'blur(80px)',
            animation: 'drift 20s ease-in-out infinite alternate',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-150px',
            right: '-150px',
            width: '400px',
            height: '400px',
            background: 'rgba(206, 230, 241, 0.15)',
            borderRadius: '50%',
            filter: 'blur(80px)',
            animation: 'drift 25s ease-in-out infinite alternate',
            animationDelay: '-5s',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '300px',
            height: '300px',
            background: 'rgba(0, 168, 77, 0.08)',
            borderRadius: '50%',
            filter: 'blur(80px)',
            animation: 'drift 30s ease-in-out infinite alternate',
            animationDelay: '-10s',
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>

      {/* Main content */}
      <main
        className="flex flex-1 items-center justify-center relative z-10"
        style={{ padding: '48px 24px' }}
      >
        <PortalHomeCard
          onPatientClick={() => handlePortalClick('patient')}
          onCaretakerClick={() => handlePortalClick('caretaker')}
        />
      </main>

      {/* Footer — small branding */}
      <footer
        className="relative z-10 flex items-center justify-center"
        style={{
          padding: '24px 24px 32px',
        }}
      >
        <span
          className="font-label uppercase text-primary/40 text-center"
          style={{ fontSize: 10, letterSpacing: '0.15em' }}
        >
          © 2024 RememberMe Clinical Sanctuary. All rights reserved.
        </span>
      </footer>
    </div>
  );
}
