/** @type {import('tailwindcss').Config} */
const withOpacity = (v) => ({ opacityValue }) =>
  opacityValue === undefined ? `rgb(var(${v}))` : `rgb(var(${v}) / ${opacityValue})`;

/**
 * LandPulse AI design tokens.
 *
 * Colours are CSS variables (src/index.css) so light and dark share one class
 * vocabulary. The type scale, weights, radii and shadows below are the only
 * sizes the product uses — pages should reach for these names rather than
 * arbitrary pixel values.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: withOpacity('--c-bg'),
        surface: withOpacity('--c-surface'),
        'surface-2': withOpacity('--c-surface-2'),
        'surface-3': withOpacity('--c-surface-3'),
        line: withOpacity('--c-line'),
        'line-strong': withOpacity('--c-line-strong'),
        ink: withOpacity('--c-ink'),
        'ink-2': withOpacity('--c-ink-2'),
        'ink-3': withOpacity('--c-ink-3'),
        brand: {
          DEFAULT: withOpacity('--c-brand'),
          soft: withOpacity('--c-brand-soft'),
          ink: withOpacity('--c-brand-ink'),
        },
        success: withOpacity('--c-success'),
        warning: withOpacity('--c-warning'),
        danger: withOpacity('--c-danger'),
        // Retained for the few code blocks that need a fixed dark ground.
        navy: {
          950: '#0B1220',
          900: '#111827',
          800: '#1F2937',
        },
        risk: {
          low: '#2F9E6E',
          medium: '#D99A1E',
          high: '#E0702A',
          critical: '#D43D3D',
          // cinematic landing palette
          med: '#e1a43c',
          crit: '#d8443a',
        },
        // Cinematic landing (src/cinematic) — only used under the .cine root.
        cine: {
          950: '#05070a',
          900: '#080b0f',
          850: '#0b0f14',
          800: '#10151b',
          700: '#171e26',
          600: '#222b35',
          500: '#344150',
        },
        mist: {
          50: '#f2f6f8',
          100: '#e3eaee',
          200: '#c3ced6',
          300: '#98a6b1',
          400: '#6f7e8a',
          500: '#52606b',
          600: '#3c4750',
        },
        gis: {
          300: '#9fd3df',
          400: '#72b8c8',
          500: '#4f9db0',
          600: '#3a7d8e',
          700: '#2a5c69',
        },
        ok: '#5aa37f',
        saffron: '#ff751f',
      },
      fontFamily: {
        sans: ['"Poppins"', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        // One family across the product; "display" only tightens tracking.
        display: ['"Poppins"', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        grotesk: ['"Poppins"', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { label: '0.16em' },
      maxWidth: { content: '1320px' },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['14px', { lineHeight: '21px' }],
        md: ['15px', { lineHeight: '23px' }],
        lg: ['17px', { lineHeight: '25px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '31px' }],
        '3xl': ['28px', { lineHeight: '35px' }],
        '4xl': ['34px', { lineHeight: '41px' }],
        '5xl': ['46px', { lineHeight: '52px' }],
      },
      // Intentional weights: headings and figures are 600, emphasis is 550.
      fontWeight: {
        semibold: '550',
        bold: '600',
        extrabold: '600',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
        '3xl': '14px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(16,24,40,0.05)',
        card: '0 1px 2px rgba(16,24,40,0.04)',
        'card-hover': '0 1px 3px rgba(16,24,40,0.08), 0 4px 12px -4px rgba(16,24,40,0.08)',
        pop: '0 2px 6px rgba(16,24,40,0.06), 0 16px 36px -12px rgba(16,24,40,0.22)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      transitionDuration: { DEFAULT: '150ms' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(.98) translateY(-2px)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
        'slide-in-left': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        'slide-in-right': { '0%': { opacity: '0', transform: 'translateX(8px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        shimmer: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        'grow-bar': { '0%': { width: '0%' }, '100%': { width: 'var(--bar-w)' } },
        indeterminate: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } },
      },
      animation: {
        'fade-up': 'fade-up .22s ease-out both',
        'fade-in': 'fade-in .18s ease-out both',
        'scale-in': 'scale-in .16s ease-out both',
        'slide-in-left': 'slide-in-left .22s cubic-bezier(.2,.8,.2,1) both',
        'slide-in-right': 'slide-in-right .2s ease-out both',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        'grow-bar': 'grow-bar .5s cubic-bezier(.2,.8,.2,1) both',
        indeterminate: 'indeterminate 1.1s ease-in-out infinite',
        // Decorative loops from the previous design resolve to nothing.
        float: 'none',
        sweep: 'none',
        'dash-flow': 'none',
        'pulse-ring': 'none',
      },
    },
  },
  plugins: [],
};
