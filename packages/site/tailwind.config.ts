/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
          5: 'var(--ink-5)',
          6: 'var(--ink-6)',
          7: 'var(--ink-7)',
          8: 'var(--ink-8)',
          9: 'var(--ink-9)',
          10: 'var(--ink-10)',
        },
        mint: { DEFAULT: 'var(--mint)', dim: 'var(--mint-dim)' },
        violet: { DEFAULT: 'var(--violet)' },
        rose: { DEFAULT: 'var(--rose)' },
        sill: { DEFAULT: 'var(--sill)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Source Serif 4', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        caption: ['13px', { lineHeight: '1.45' }],
        'body-sm': ['14px', { lineHeight: '1.55' }],
        body: ['16px', { lineHeight: '1.6' }],
        'body-lg': ['18px', { lineHeight: '1.6' }],
        h4: ['20px', { lineHeight: '1.35' }],
        h3: ['24px', { lineHeight: '1.3' }],
        h2: ['32px', { lineHeight: '1.2' }],
        h1: ['40px', { lineHeight: '1.15' }],
        'display-3': ['48px', { lineHeight: '1.1' }],
        'display-2': ['64px', { lineHeight: '1.05' }],
        'display-1': ['88px', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      maxWidth: {
        measure: '68ch',
        column: '680px',
      },
    },
  },
  plugins: [],
};