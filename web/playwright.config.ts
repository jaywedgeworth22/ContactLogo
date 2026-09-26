import { defineConfig } from '@playwright/test';

// Fleet rollout scaffold: chromium-only smoke tests against a local server.
// Point PLAYWRIGHT_BASE_URL at a deployed environment to run against it.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const host = new URL(baseURL).hostname;
const localServer = ['127.0.0.1', 'localhost', '[::1]'].includes(host);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // A deployed URL is already running; only boot Vite for local smoke runs.
  webServer: localServer ? {
    command: 'npm run preview -- --port 4173 --host 127.0.0.1',
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  } : undefined,
});
