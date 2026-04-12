/**
 * Header — role-pilled identity band.
 *
 * Not a card. A band. 1px bottom rule on --rule, no shadow.
 *
 * Layout:
 *   [  ROLE-PILL   ] [            name + description            ]
 *
 * Typography (plan D2.6):
 *   - Pill:        Fraunces 14px tracking-wide uppercase, 1px --accent border,
 *                  6x10 padding, 4px radius, no fill.
 *   - Name:        Fraunces 32px, --ink-primary, letter-spacing -0.02em.
 *   - Description: Newsreader 16px, --ink-secondary.
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
  caretaker: 'CARETAKER',
};

export function Header({ role, name, description }: HeaderProps): ReactElement {
  return (
    <header
      className="relative flex items-center gap-8 px-10 py-6"
      style={{ borderBottom: '1px solid var(--rule)' }}
    >
      <span
        className="font-display uppercase"
        style={{
          fontSize: 14,
          letterSpacing: '0.14em',
          fontWeight: 600,
          padding: '6px 10px',
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          borderRadius: 4,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
        aria-label={`Role: ${ROLE_LABEL[role]}`}
      >
        {ROLE_LABEL[role]}
      </span>

      <div className="flex-1 flex flex-col justify-center" style={{ minHeight: 48 }}>
        <h1
          className="font-display text-ink-primary"
          style={{
            fontSize: 32,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {name}
        </h1>
        {description ? (
          <p
            className="font-text text-ink-secondary"
            style={{ fontSize: 16, lineHeight: 1.5, marginTop: 4 }}
          >
            {description}
          </p>
        ) : null}
      </div>
    </header>
  );
}
