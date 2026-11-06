import { chromium, type FullConfig } from '@playwright/test'

/**
 * Warms a cold dev server before the first spec runs. Nuxt/Vite compile the client bundle lazily on
 * the first browser request, which made the first test of every worker time out (#219, #250).
 * The suite now runs against a production build (#541), which compiles nothing lazily, so the warm-up is one cheap
 * page load there; it stays for the `BASE_URL=<npm run dev:e2e>` debugging path, where it still matters.
 * Runs against the configured baseURL, so it also covers an external server via BASE_URL.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) return

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL, locale: 'de-DE' })
    await page.goto('/tasks?seed=local', { timeout: 120_000 })
    await page.locator('#column-open').waitFor({ state: 'visible', timeout: 120_000 })
  } finally {
    await browser.close()
  }
}
