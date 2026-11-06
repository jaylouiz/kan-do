import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Use a fixed port for E2E tests
// If BASE_URL is provided, use it directly (assumes server is already running)
const testPort = parseInt(process.env.PORT || '3000', 10)
const baseURL = process.env.BASE_URL || `http://localhost:${testPort}`

// Skip webServer if BASE_URL is explicitly provided (external server: any running server, e.g. `npm run dev:e2e`
// for debugging against `nuxt dev`; without BASE_URL the suite builds and serves the production build, #541)
const useExternalServer = !!process.env.BASE_URL

console.log(`[Playwright] Base URL: ${baseURL}`)
console.log(`[Playwright] External server mode: ${useExternalServer}`)

export default defineConfig({
  testDir: __dirname,
  // Warms the cold dev server so the first specs do not time out on the lazy client compile (#219)
  globalSetup: './global-setup.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // 2 vCPU runners: two workers cut wall-clock time without sharding overhead. Locally unset (Playwright: half the cores, 6 on this
  // 12-core machine; the numbers below are from it). Measured against the production build, 998 tests, quiet, median of 2 (#547):
  // 6 workers 261 s, 8: 260 s, 10: 244 s (-7 %, under the 10 % bar). Under load (a second full suite started 60 s
  // earlier) 6 workers 440 s, 10 workers 448 s and 2 flaky. The load-adaptive `--workers=2` of `e2eArgs` stays.
  workers: process.env.CI ? 2 : undefined,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixels: 50,
      threshold: 0.05,
    },
  },
  snapshotPathTemplate: 'snapshots/{testFilePath}/{arg}{ext}',
  use: {
    baseURL,
    locale: 'de-DE',
    headless: process.env.HEADLESS === '0' ? false : true,
    screenshot: 'only-on-failure',
    // `on-first-retry` for both is 13 % faster at 6 workers and 34 % at 10 (172 s), but with no recording on the first
    // attempt the palette-delete specs flake (3 of 4 full runs, #574; 0 of 6 with `retain-on-failure`), so it stays.
    // Revisit once #574 is fixed: the gate and release retry once (`--retries=1`), so every failure there would still
    // have a trace and video; a plain local run has no retries and would need `retries` set.
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: useExternalServer ? undefined : {
    // Builds a Nitro node-server into .e2e-build/<port> and serves it (scripts/e2e-server.mjs, #541); the timeout covers a cold build.
    command: `node ${JSON.stringify(resolve(__dirname, '../../scripts/e2e-server.mjs'))}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Without this Playwright SIGKILLs the process group and the script's cleanup never runs (.e2e-build/<port> would pile up)
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      E2E_NOTION_STUB: process.env.E2E_NOTION_STUB || '1',
      PORT: testPort.toString(),
    },
  },
  // Projects for different browsers (optional)
  projects: [
    {
      name: 'chromium',
      use: { 
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'e2e-results.json' }],
    ['list'],
  ],
  // Output directory for test artifacts
  outputDir: 'test-results',
})
