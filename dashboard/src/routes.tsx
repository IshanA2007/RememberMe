/**
 * Dashboard routes (FRONTEND_SPEC §2.2 + plan D2.5).
 *
 * Role enforcement lives in <RequireRole>:
 *   - Waits on useMe() to resolve.
 *   - Redirects to `/` on role mismatch.
 *   - Toggles `document.body.classList.role-caretaker` so the CSS variable
 *     `--accent` swaps to the caretaker sienna (plan §0.2). This is a side
 *     effect, NOT render state.
 *
 * Page components are stubs (exported empty surfaces). Task D3 fills them.
 */

import { useEffect, type ReactElement } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  type RouteProps,
} from 'react-router-dom';

import { useMe } from './auth/useMe';
import type { Role } from './types/api';

// Stub pages (Task D3 will flesh these out).
import { HomePage } from './pages/Home';
import { PatientHomePage } from './pages/patient/PatientHome';
import { PatientFacesPage } from './pages/patient/Faces';
import { PatientFaceDetailPage } from './pages/patient/FaceDetail';
import { PatientRemindersPage } from './pages/patient/Reminders';
import { PatientSettingsPage } from './pages/patient/Settings';
import { CaretakerHomePage } from './pages/caretaker/CaretakerHome';
import { CaretakerPatientHomePage } from './pages/caretaker/CaretakerPatientHome';
import { CaretakerFacesPage } from './pages/caretaker/CaretakerFaces';
import { CaretakerFaceDetailPage } from './pages/caretaker/CaretakerFaceDetail';
import { CaretakerRemindersPage } from './pages/caretaker/CaretakerReminders';

// ---------------------------------------------------------------------------
// Loading splash
// ---------------------------------------------------------------------------

/**
 * Calm, centered loading state — Fraunces display, no spinner, no pulse.
 * Used while `useMe()` is resolving. Mirrors frontend.mdc §4.5: no infinite
 * breathing animation on this surface.
 */
function CenteredLoading(): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <p
        className="font-display text-ink-secondary"
        style={{ fontSize: 28, letterSpacing: '-0.02em' }}
      >
        Loading…
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RequireRole — role gate + body-class side effect
// ---------------------------------------------------------------------------

export interface RequireRoleProps {
  role: Role;
  children: ReactElement;
}

export function RequireRole({ role, children }: RequireRoleProps): ReactElement {
  const { me, isLoading } = useMe();
  const location = useLocation();

  // Swap the caretaker accent on/off as this subtree mounts. Runs on every
  // resolved `me` — and on unmount we clear the override so the next tree
  // (patient, or home) sees the default accent.
  useEffect(() => {
    const isCaretaker = me?.role === 'caretaker';
    document.body.classList.toggle('role-caretaker', isCaretaker);
    return () => {
      // Only strip it if THIS subtree had set it; if another RequireRole
      // upstream needs the class it will reapply in its own effect.
      if (isCaretaker) {
        document.body.classList.remove('role-caretaker');
      }
    };
  }, [me?.role]);

  if (isLoading) return <CenteredLoading />;
  if (!me) {
    // Send caller home; Home renders the portal picker / login affordances.
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  if (me.role !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

export type DashboardRouteProps = RouteProps; // re-export for test harnesses

export function RoutesConfig(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      {/* Patient portal */}
      <Route
        path="/patient"
        element={
          <RequireRole role="patient">
            <PatientHomePage />
          </RequireRole>
        }
      />
      <Route
        path="/patient/faces"
        element={
          <RequireRole role="patient">
            <PatientFacesPage />
          </RequireRole>
        }
      />
      <Route
        path="/patient/faces/:id"
        element={
          <RequireRole role="patient">
            <PatientFaceDetailPage />
          </RequireRole>
        }
      />
      <Route
        path="/patient/reminders"
        element={
          <RequireRole role="patient">
            <PatientRemindersPage />
          </RequireRole>
        }
      />
      <Route
        path="/patient/settings"
        element={
          <RequireRole role="patient">
            <PatientSettingsPage />
          </RequireRole>
        }
      />

      {/* Caretaker portal */}
      <Route
        path="/caretaker"
        element={
          <RequireRole role="caretaker">
            <CaretakerHomePage />
          </RequireRole>
        }
      />
      <Route
        path="/caretaker/:patient_id"
        element={
          <RequireRole role="caretaker">
            <CaretakerPatientHomePage />
          </RequireRole>
        }
      />
      <Route
        path="/caretaker/:patient_id/faces"
        element={
          <RequireRole role="caretaker">
            <CaretakerFacesPage />
          </RequireRole>
        }
      />
      <Route
        path="/caretaker/:patient_id/faces/:face_id"
        element={
          <RequireRole role="caretaker">
            <CaretakerFaceDetailPage />
          </RequireRole>
        }
      />
      <Route
        path="/caretaker/:patient_id/reminders"
        element={
          <RequireRole role="caretaker">
            <CaretakerRemindersPage />
          </RequireRole>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
