import { defineConfig } from '@playwright/test';
const port = process.env.CAMPUS_TEST_PORT ?? '2667';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e-production', timeout: 90000, expect: { timeout: 30000 }, workers: 1,
  outputDir: process.env.CAMPUS_EVIDENCE_DIR ?? '.superpowers/sdd/campus/production-browser-artifacts',
  use: { baseURL, viewport: { width: 1100, height: 720 }, screenshot: 'only-on-failure', launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm start', env: { HOST: '127.0.0.1', PORT: port }, url: `${baseURL}/health`, reuseExistingServer: false, timeout: 30000 },
});
