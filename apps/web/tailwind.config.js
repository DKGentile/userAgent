import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Absolute, forward-slashed content globs so Tailwind scans the right files
// regardless of the working directory Vite is launched from.
const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

/** @type {import('tailwindcss').Config} */
export default {
  content: [`${root}/index.html`, `${root}/src/**/*.{ts,tsx}`],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070a12',
          900: '#0a0e17',
          850: '#0d121d',
          800: '#111827',
          700: '#1a2334',
          600: '#243044',
        },
        line: '#1f2a3c',
        brand: {
          DEFAULT: '#6366f1',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
        },
        cyanide: '#22d3ee',
        approve: '#34d399',
        deny: '#fb7185',
        request: '#fbbf24',
        escalate: '#a78bfa',
        muted: '#8b97ab',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(99,102,241,0.25), 0 8px 40px -12px rgba(99,102,241,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 16px 40px -24px rgba(0,0,0,0.8)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseline: {
          '0%,100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        pulseline: 'pulseline 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
