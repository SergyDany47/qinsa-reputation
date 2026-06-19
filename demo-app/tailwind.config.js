/** Helper: color desde variable CSS con soporte de <alpha-value> */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: v('--ocean-50'), 100: v('--ocean-100'), 200: v('--ocean-200'),
          300: v('--ocean-300'), 400: v('--ocean-400'), 500: v('--ocean-500'),
          600: v('--ocean-600'), 700: v('--ocean-700'), 800: v('--ocean-800'),
          900: v('--ocean-900'),
          DEFAULT: v('--ocean-600'),
        },
        lime: {
          100: v('--lime-100'), 200: v('--lime-200'), 300: v('--lime-300'),
          400: v('--lime-400'), 500: v('--lime-500'), 600: v('--lime-600'),
          DEFAULT: v('--lime-300'),
        },
        surface: v('--surface'),
        // Alias de compatibilidad (código antiguo que aún use qinsa-*)
        qinsa: {
          blue: v('--ocean-600'),
          green: '#00A86B',
          light: v('--ocean-50'),
        },
      },
      borderRadius: { '2xl': '1rem', '3xl': '1.5rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 46 61 / 0.04), 0 1px 3px 0 rgb(16 46 61 / 0.06)',
        soft: '0 4px 16px -2px rgb(16 46 61 / 0.08)',
      },
    },
  },
  plugins: [],
}
