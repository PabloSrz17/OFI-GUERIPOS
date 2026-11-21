import type { Config } from 'tailwindcss';

// Valores medidos en reference/pulpos/design-system.md.
// La paleta gris/sky/green/red/amber/indigo es la de Tailwind por defecto; solo se añade la marca.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#00A4AE',
          hover: '#00939C',
          active: '#00838B',
          light: '#55C2C9',
          foreground: '#FFFFFF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['Manrope', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(0,0,0,0.15), 0 0 5px 0 rgba(23,24,24,0.05)',
      },
      // En "spacing" para que sirvan en h-, w- y size- (control = alto de botones e inputs).
      spacing: { control: '38px', header: '64px', sidebar: '240px', 'sidebar-collapsed': '60px' },
    },
  },
  plugins: [],
} satisfies Config;
