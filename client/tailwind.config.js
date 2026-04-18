/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  'var(--calo-50, #E6F9F1)',
          100: 'var(--calo-100, #CFF3E3)',
          200: 'var(--calo-200, #9FE6C6)',
          300: 'var(--calo-300, #66D7A5)',
          400: 'var(--calo-400, #26CF93)',
          500: 'var(--calo-500, #02B376)',
          600: 'var(--calo-600, #029A66)',
          700: 'var(--calo-700, #027D53)',
          800: 'var(--calo-800, #016040)',
          900: 'var(--calo-900, #01432D)',
        },
        calo: {
          50:  'var(--calo-50, #E6F9F1)',
          100: 'var(--calo-100, #CFF3E3)',
          200: 'var(--calo-200, #9FE6C6)',
          300: 'var(--calo-300, #66D7A5)',
          400: 'var(--calo-400, #26CF93)',
          500: 'var(--calo-500, #02B376)',
          600: 'var(--calo-600, #029A66)',
          700: 'var(--calo-700, #027D53)',
          800: 'var(--calo-800, #016040)',
          900: 'var(--calo-900, #01432D)',
        },
        ink: {
          0:   '#FFFFFF',
          50:  '#FAFAF7',
          100: '#F4F4F0',
          200: '#E8E9E3',
          300: '#D5D6CF',
          400: '#A8ABA1',
          500: '#787C72',
          600: '#4E524A',
          700: '#2F332C',
          800: '#1A1D17',
          900: '#0A1F17',
        },
      },
      fontFamily: {
        sans: ['Lato', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        xs: '6px', sm: '10px', md: '14px', lg: '20px', xl: '28px', pill: '999px',
      },
      boxShadow: {
        'paper-sm': '0 1px 2px rgba(10,31,23,0.04), 0 1px 3px rgba(10,31,23,0.03)',
        'paper':    '0 4px 10px rgba(10,31,23,0.04), 0 2px 6px rgba(10,31,23,0.04)',
        'paper-lg': '0 12px 32px rgba(10,31,23,0.08), 0 4px 10px rgba(10,31,23,0.04)',
        'paper-xl': '0 24px 60px rgba(10,31,23,0.10), 0 8px 24px rgba(10,31,23,0.06)',
      },
      letterSpacing: {
        tightest: '-0.04em', tighter: '-0.03em', tight: '-0.02em',
      },
      animation: {
        'fade-in': 'fadeIn .35s ease both',
        'slide-up': 'slideUp .5s cubic-bezier(.2,.7,.2,1) both',
      },
    },
  },
  plugins: [],
};
