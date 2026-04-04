/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        hive: {
          bg: '#060609',
          bg2: '#0B0B12',
          bg3: '#101018',
          surface: '#141420',
          gold: '#F5A623',
          'gold-light': '#FFD080',
          'gold-dim': 'rgba(245,166,35,0.1)',
          text: '#EAEAF0',
          sub: '#B0B4C4',
          muted: '#6E738A',
          dim: '#3A3E52',
          border: '#1A1A2C',
          green: '#34D399',
          red: '#F87171',
          cyan: '#22D3EE',
          purple: '#A78BFA',
          pink: '#F472B6',
          orange: '#FB923C',
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'Helvetica Neue', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
