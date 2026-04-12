/**
 * EditModeToggle — bottom-center ghost button that enters Edit Mode; in edit
 * state, Save + Cancel appear alongside (FRONTEND_SPEC §2.3 / frontend.mdc
 * §6.2).
 *
 * Not a Tailwind default primary button. Rendered as rule-bordered ghost
 * affordances; the `Save` action promotes to a filled --accent background
 * so intent reads immediately.
 */

import type { ReactElement } from 'react';

export interface EditModeToggleProps {
  editing: boolean;
  onToggle: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  /** Optional label override for the primary toggle; defaults to "Edit". */
  toggleLabel?: string;
}

const BASE_BUTTON_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  padding: '10px 20px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 2,
  lineHeight: 1,
};

export function EditModeToggle({
  editing,
  onToggle,
  onSave,
  onCancel,
  toggleLabel = 'Edit',
}: EditModeToggleProps): ReactElement {
  if (editing) {
    return (
      <div
        className="flex items-center justify-center gap-3"
        style={{ paddingTop: 24, paddingBottom: 16 }}
      >
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="font-headline text-tertiary"
            style={{
              ...BASE_BUTTON_STYLE,
              border: '1px solid var(--outline-variant)',
              background: 'transparent',
              color: 'var(--tertiary)',
            }}
          >
            Cancel
          </button>
        ) : null}
        {onSave ? (
          <button
            type="button"
            onClick={onSave}
            className="font-headline"
            style={{
              ...BASE_BUTTON_STYLE,
              border: '1px solid var(--accent)',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-primary)',
            }}
          >
            Save
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center"
      style={{ paddingTop: 24, paddingBottom: 16 }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="font-headline text-on-surface"
        style={{
          ...BASE_BUTTON_STYLE,
          border: '1px solid var(--on-surface)',
          background: 'transparent',
          color: 'var(--on-surface)',
        }}
      >
        {toggleLabel}
      </button>
    </div>
  );
}
