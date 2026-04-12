// BootScreen — fullscreen pre-ready state (FRONTEND_SPEC §1.2 "booting").
//
// Shown while the camera initializes and/or the WebSocket has not yet
// delivered `session_ready`. Spec allowances:
//   - Fraunces 56px wordmark on the brand; Newsreader 24px body copy
//     (FRONTEND_SPEC §1.4 "never below 20 px").
//   - A single spinner with `animation-iteration-count: infinite` — the only
//     place in Vision where an infinite animation is allowed (frontend.mdc §4.5).
//   - `role="status"` + `aria-live="polite"` text mirror so screen readers
//     hear the startup message (FRONTEND_SPEC §3.4).

export function BootScreen(): JSX.Element {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center bg-bg-base"
      style={{ color: "var(--ink-primary)" }}
    >
      <h1
        className="font-display font-bold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "56px",
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          color: "var(--ink-primary)",
        }}
      >
        RememberMe
      </h1>
      <p
        className="mt-6"
        style={{
          fontFamily: "var(--font-text)",
          fontSize: "24px",
          lineHeight: 1.5,
          color: "var(--ink-secondary)",
        }}
        role="status"
        aria-live="polite"
      >
        Starting camera…
      </p>
      <div
        aria-hidden="true"
        className="mt-10"
        style={{
          width: "32px",
          height: "32px",
          border: "2px solid var(--rule)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "rm-boot-spin 1.2s linear infinite",
        }}
      />
      <style>{`
        @keyframes rm-boot-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default BootScreen;
