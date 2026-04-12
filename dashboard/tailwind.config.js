/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': 'var(--bg-base)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-sunken': 'var(--bg-sunken)',
        'ink-primary': 'var(--ink-primary)',
        'ink-secondary': 'var(--ink-secondary)',
        'ink-inverse': 'var(--ink-inverse)',
        accent: 'var(--accent)',
        'accent-patient': 'var(--accent-patient)',
        'accent-caretaker': 'var(--accent-caretaker)',
        'accent-ink': 'var(--accent-ink)',
        'signal-warm': 'var(--signal-warm)',
        'signal-cool': 'var(--signal-cool)',
        rule: 'var(--rule)',
        'focus-ring': 'var(--focus-ring)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        text: 'var(--font-text)',
        mono: 'var(--font-mono)',
      },
    },
  },
  plugins: [],
};
