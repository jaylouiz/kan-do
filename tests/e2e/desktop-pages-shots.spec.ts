import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { seedLocalBoard } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { installTauriStub } from './helpers/tauriStub'

/**
 * Opt-in screenshots of the desktop-only routes (`/settings/data`, `/settings/github`) through
 * `installTauriStub` at desktop and 390px (#288, #302). Skipped unless `DESKTOP_SHOTS_DIR=<dir>` is
 * set; then it renders each page and writes `<route>-<desktop|390>.png` there (reviewing a UI change,
 * attaching to a PR). `DESKTOP_SHOTS_ROUTES=/settings/data` narrows the routes.
 *
 *   DESKTOP_SHOTS_DIR=<dir> PORT=3101 npm run test:e2e -- tests/e2e/desktop-pages-shots.spec.ts
 */

const ROUTES: Array<{ path: string, ready: (page: Page) => ReturnType<Page['locator']> }> = [
  { path: '/settings/data', ready: page => page.getByRole('heading', { name: 'Datenordner', level: 2 }) },
  { path: '/settings/github', ready: page => page.getByRole('region', { name: 'Updates' }) },
]
const VIEWPORTS = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  { name: '390', size: { width: 390, height: 844 } },
] as const

const shotsDir = process.env.DESKTOP_SHOTS_DIR
const only = process.env.DESKTOP_SHOTS_ROUTES?.split(',').map(r => r.trim()).filter(Boolean)

test.skip(!shotsDir, 'set DESKTOP_SHOTS_DIR to render desktop-page screenshots')

for (const route of ROUTES.filter(r => !only || only.includes(r.path))) {
  for (const viewport of VIEWPORTS) {
    test(`${route.path} renders under the Tauri stub, ${viewport.name}`, async ({ context, page }) => {
      await seedLocalBoard(context)
      await installTauriStub(context)
      await page.setViewportSize(viewport.size)
      await page.goto(route.path)
      await expect(route.ready(page)).toBeVisible()
      await settleAnimations(page)
      mkdirSync(shotsDir!, { recursive: true })
      await page.screenshot({ path: join(shotsDir!, `${route.path.slice(1).replace(/\//g, '-')}-${viewport.name}.png`), fullPage: true })
    })
  }
}
