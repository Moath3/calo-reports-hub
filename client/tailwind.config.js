/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50, #E6F9F1)',
          100: 'var(--brand-100, #B3EED8)',
          200: 'var(--brand-200, #80E3BF)',
          300: 'var(--brand-300, #4DD8A6)',
          400: 'var(--brand-400, #26CF93)',
          500: 'var(--brand-500, #02B376)',
          600: 'var(--brand-600, #029A66)',
          700: 'var(--brand-700, #027D53)',
          800: 'var(--brand-800, #016040)',
          900: 'var(--brand-900, #01432D)',
        }
      },
      fontFamily: {
        sans: ['Lato', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { '0%': { opacity: '0', transform: 'translateX(-10px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
      }
    },
  },
  plugins: [],
};
