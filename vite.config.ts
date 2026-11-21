/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Puerto fijo: Tauri (src-tauri/tauri.conf.json) apunta a este devUrl.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  clearScreen: false,
  // host: true → accesible desde otras PCs de la red local (p. ej. la del mostrador).
  server: { port: 1420, strictPort: true, host: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
