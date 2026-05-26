/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#09090b',
          surface: '#111118',
          elevated: '#18181f',
        },
        border: {
          DEFAULT: '#27272a',
          subtle: '#1c1c21',
        },
        text: {
          primary: '#fafafa',
          secondary: '#a1a1aa',
          muted: '#52525b',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          muted: 'rgba(99,102,241,0.12)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
