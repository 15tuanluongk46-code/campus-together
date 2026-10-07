import { defineConfig } from '@playwright/test';
const port = process.env.CAMPUS_TEST_PORT ?? '2667';
const clientPort = process.env.CAMPUS_CLIENT_PORT ?? '5273';
process.env.CAMPUS_TEST_PORT = port;
const baseURL = `http://127.0.0.1:${clientPort}`;
const hardwareArgs = ['--ozone-platform=x11', '--use-gl=angle', `--use-angle=${process.env.CAMPUS_ANGLE ?? 'gl'}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
if (process.env.CAMPUS_ANGLE === 'vulkan') hardwareArgs.push('--enable-features=Vulkan', '--ignore-gpu-blocklist');
export default defineConfig({
  testDir: './tests/e2e', timeout: 240000, expect: { timeout: 20000 }, workers: 1, fullyParallel: false,
  outputDir: process.env.CAMPUS_EVIDENCE_DIR ?? '.superpowers/sdd/campus/browser-artifacts',
  reporter: [['list'], ['html', { outputFolder: process.env.CAMPUS_REPORT_DIR ?? '.superpowers/sdd/campus/playwright-report', open: 'never' }]],
  use: { baseURL, headless: process.env.CAMPUS_HEADED !== '1', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: process.env.CAMPUS_HARDWARE === '1' ? hardwareArgs : ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run dev', env: { HOST: '127.0.0.1', PORT: port, CAMPUS_CLIENT_PORT: clientPort }, url: baseURL, timeout: 60000, reuseExistingServer: false },
});
