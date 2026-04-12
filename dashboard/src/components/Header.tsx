/**
 * Header — fixed glassmorphism top bar with brand lockup and role pill.
 *
 * Layout:
 *   [  RememberMe + ROLE-PILL  ] [ spacer ] [ user name ]
 *
 * Design:
 *   - Fixed top bar, glassmorphism backdrop, soft shadow
 *   - Brand: Plus Jakarta Sans 24px bold
 *   - Role pill: filled primary-container bg, white text, rounded-full
 *   - User greeting: Plus Jakarta Sans 16px, tertiary muted tone
 */

import type { ReactElement } from 'react';
import type { Role } from '../types/api';

export interface HeaderProps {
  role: Role;
  name: string;
  description?: string;
}

const ROLE_LABEL: Record<Role, string> = {
  patient: 'PATIENT',
  caretaker: 'CAREGIVER',
};

export function Header({ role, name, description }: HeaderProps): ReactElement {
  return (
    <header
      className="fixed top-0 w-full z-50 flex items-center justify-between px-6 py-4"
      style={{
        background: 'rgba(245, 250, 250, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
        animation: 'slideUpFromTop 0.5s ease-out',
      }}
    >
      {/* Left: Brand + Role Pill */}
      <div className="flex items-center gap-4">
        <span
          className="font-headline text-primary font-bold tracking-tight"
          style={{ fontSize: 24 }}
        >
          RememberMe
        </span>
        <span
          className="font-headline uppercase font-bold text-on-primary px-3 py-1 rounded-full"
          style={{
            fontSize: 11,
            letterSpacing: '0.14em',
            backgroundColor: 'var(--primary-container)',
            whiteSpace: 'nowrap',
          }}
          aria-label={`Role: ${ROLE_LABEL[role]}`}
        >
          {ROLE_LABEL[role]}
        </span>
      </div>

      {/* Right: User name + optional description */}
      <div className="flex flex-col items-end justify-center">
        <p
          className="font-headline text-on-surface font-semibold"
          style={{ fontSize: 16, margin: 0 }}
        >
          {name}
        </p>
        {description ? (
          <p
            className="text-tertiary"
            style={{ fontSize: 14, margin: 0, marginTop: 2 }}
          >
            {description}
          </p>
        ) : null}
      </div>
    </header>
  );
}
