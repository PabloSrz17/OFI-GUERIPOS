import { defineConfig } from '@playwright/test';

// Mismo viewport que las capturas de referencia de Pulpos (1416×808) para comparar 1:1.
// Usa Microsoft Edge instalado (canal msedge): no requiere descargar Chromium.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    channel: 'msedge',
    viewport: { width: 1416, height: 808 },
    locale: 'es-MX',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
