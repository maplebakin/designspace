
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ui-bg': 'var(--ui-bg)',
        'ui-panel': 'var(--ui-panel)',
        'ui-accent': 'var(--ui-accent)',
        'ui-text': 'var(--ui-text)',
        'ui-border': 'var(--ui-border)',
      },
    },
  },
  plugins: [],
}
