/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--bg-base)",
        "bg-elevated": "var(--bg-elevated)",
        "ink-primary": "var(--ink-primary)",
        "ink-secondary": "var(--ink-secondary)",
        accent: "var(--accent)",
        "signal-cool": "var(--signal-cool)",
        "signal-warm": "var(--signal-warm)",
        rule: "var(--rule)",
      },
      fontFamily: {
        display: "var(--font-display)",
        text: "var(--font-text)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
