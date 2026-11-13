/**
 * FE-09 Playwright config: the primary-flow E2E test (`npm run test:e2e`).
 *
 * It runs the production build (`next start`), so run `npm run build` first.
 * CI does that in the step before. Traces stay off; to debug a failure, run
 * `npx playwright test --trace on`.
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 4310

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['github']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // The same laptop viewport the fold check uses.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
})
