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
            className="font-display text-ink-secondary"
            style={{
              ...BASE_BUTTON_STYLE,
              border: '1px solid var(--rule)',
              background: 'transparent',
              color: 'var(--ink-secondary)',
            }}
          >
            Cancel
          </button>
        ) : null}
        {onSave ? (
          <button
            type="button"
            onClick={onSave}
            className="font-display"
            style={{
              ...BASE_BUTTON_STYLE,
              border: '1px solid var(--accent)',
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-ink)',
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
        className="font-display text-ink-primary"
        style={{
          ...BASE_BUTTON_STYLE,
          border: '1px solid var(--ink-primary)',
          background: 'transparent',
          color: 'var(--ink-primary)',
        }}
      >
        {toggleLabel}
      </button>
    </div>
  );
}
