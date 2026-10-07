import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';
export default defineConfig({
  ...config,
  testDir: './tests/e2e-startup',
  outputDir: process.env.CAMPUS_EVIDENCE_DIR ?? '.superpowers/sdd/campus/task4-startup',
  reporter: 'list',
  webServer: { command: 'npm run dev', url: `http://127.0.0.1:${process.env.CAMPUS_CLIENT_PORT ?? 5273}`, timeout: 60000, reuseExistingServer: false, env: { HOST: '127.0.0.1', PORT: process.env.CAMPUS_TEST_PORT ?? '2667', CAMPUS_CLIENT_PORT: process.env.CAMPUS_CLIENT_PORT ?? '5273', VITE_SERVER_URL: 'not-a-valid-endpoint' } },
});
