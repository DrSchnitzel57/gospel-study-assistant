/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1a365d',
          light: '#2b6cb0',
          dark: '#0f2440',
        },
        accent: {
          DEFAULT: '#c53030',
          light: '#fc8181',
        },
        badge: {
          primary: '#3182ce',
          secondary: '#718096',
          official: '#38a169',
          unofficial: '#dd6b20',
          core: '#d69e2e',
          supporting: '#319795',
          policy: '#805ad5',
          esoteric: '#e53e3e',
        },
      },
    },
  },
  plugins: [],
};
