// ErrorScreen — fullscreen terminal state (FRONTEND_SPEC §1.2 "error").
//
// Shown when:
//   - session.hasSession() returns false (missing token or patient_id)
//   - WebSocket close code ∈ {4401, 4403, 4409, 4500}
//   - Camera permission denied
//
// Spec constraints:
//   - One centered status + one retry button (frontend.mdc §6.1 / FRONTEND_SPEC §1.2).
//   - Title ≥24 px, body ≥20 px (FRONTEND_SPEC §1.4).
//   - Retry button is a ghost-style button: 2px --accent border, no fill,
//     2px radius max (plan V3 Step 2).
//   - `role="alert"` for screen readers.
//   - Reduced motion is respected globally via the CSS in styles/index.css.

export interface ErrorScreenProps {
  title: string;
  message: string;
  /** If omitted, no retry affordance is rendered (e.g. missing-session case). */
  onRetry?: () => void;
}

export function ErrorScreen(props: ErrorScreenProps): JSX.Element {
  return (
    <div
      role="alert"
      className="fixed inset-0 flex items-center justify-center bg-bg-base"
    >
      <div
        className="flex flex-col items-center text-center"
        style={{ maxWidth: "480px", padding: "0 24px" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "40px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "var(--ink-primary)",
            margin: 0,
          }}
        >
          {props.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-text)",
            fontSize: "20px",
            lineHeight: 1.5,
            color: "var(--ink-secondary)",
            marginTop: "24px",
            marginBottom: 0,
          }}
        >
          {props.message}
        </p>
        {props.onRetry !== undefined ? (
          <button
            type="button"
            onClick={props.onRetry}
            style={{
              marginTop: "32px",
              fontFamily: "var(--font-display)",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--accent)",
              background: "transparent",
              border: "2px solid var(--accent)",
              borderRadius: "2px",
              padding: "12px 24px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ErrorScreen;
