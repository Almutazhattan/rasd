import type { Config } from 'tailwindcss';

/** RASD design tokens — Charcoal ground, Sand accent, Blue action. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: '#1E1E1C',
        panel: '#232321',
        surface: '#2A2A26',
        blue: { DEFAULT: '#2F6BFF', soft: '#5B88FF' },
        sand: { DEFAULT: '#D8CBB3', deep: '#B9A98C' },
        ink: '#F3EFE6',
        muted: '#A39D90',
        ok: '#4ADE80',
        warn: '#D8CBB3',
        danger: '#F87171',
      },
      fontFamily: {
        display: ['"Thmanyah Serif Display"', '"Thmanyah Sans"', 'serif'],
        sans: ['"Thmanyah Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        text: ['"IBM Plex Sans Arabic"', '"Thmanyah Sans"', 'system-ui', 'sans-serif'],
      },
      // one vertical rhythm: 3 · 5 · 7 · 10 · 14 · 20
      spacing: { rhythm: '1.75rem' },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
} satisfies Config;
