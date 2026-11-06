import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

/**
 * Rendered Impeccable detector matrix: every main surface and state at 1280 and 390, scanned with
 * `impeccable detect --cdp` on the page the test seeded and opened (the pinned devDependency).
 *
 * Why rendered: `.vue` files get the detector's regex rules only (`npm run design:detect`), so the element rules
 * (contrast, tiny text, touch targets, overflow) reach the components only here. Why `--cdp` and not a URL scan:
 * the detector then scans the page as this test left it (seeded through `addInitScript`, a sheet open, a column page
 * shown) and never navigates or resizes it.
 *
 * Only primary findings fail; advisories are printed. A justified exception goes through
 * `npx impeccable hooks ignore-value <rule> <value>` (`.impeccable/config.json`) with a reason, never a skip here.
 * Runs in the pre-merge gate for every PR that touches a UI path, style-only ones included (`design` in
 * `.claude/hooks/e2e-gate.json`).
 */

const run = promisify(execFile)
const CLI = resolve(__dirname, '../../node_modules/impeccable/cli/bin/cli.js')
const VIEWPORTS = [
  { label: '1280', viewport: { width: 1280, height: 800 } },
  { label: '390', viewport: { width: 390, height: 844 }, mobile: true },
] as const

interface Finding {
  antipattern: string
  description: string
  advisory?: boolean
  snippet?: string
}

/**
 * Open findings with an issue, matched narrowly (surface + rule + snippet text). A known finding that no longer
 * shows up fails the test too, so the entry goes away with its fix.
 */
const KNOWN_FINDINGS: { surface: string, rule: string, snippet: string, issue: number }[] = []

interface Surface {
  name: string
  open: (page: Page, context: BrowserContext) => Promise<void>
}

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open')).toBeVisible()
}

const SURFACES: Surface[] = [
  {
    name: 'board',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await gotoBoard(page)
    },
  },
  {
    name: 'empty board',
    open: async (page, context) => {
      await seedLocalBoard(context, [])
      await gotoBoard(page)
    },
  },
  {
    name: 'task detail sheet',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await page.goto(`/tasks/${SEED_TASKS[0]!.id}`)
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'add task sheet',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await page.goto('/tasks/add')
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'new card, title step',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await gotoBoard(page)
      await page.locator('#column-open .add-task-button').click()
      await expect(page.getByTestId('new-card-title')).toBeFocused()
    },
  },
  {
    name: 'new card, choice step',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await gotoBoard(page)
      await page.locator('#column-open .add-task-button').click()
      await page.getByTestId('new-card-title').fill('Angebot schreiben')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('new-card-options')).toBeVisible()
    },
  },
  {
    name: 'statistics',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await page.goto('/statistics')
      await expect(page.locator('main')).toBeVisible()
    },
  },
  {
    name: 'settings',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await page.goto('/settings')
      await expect(page.locator('main')).toBeVisible()
    },
  },
  {
    name: 'trash',
    open: async (page, context) => {
      await seedLocalBoard(context)
      await page.goto('/trash')
      await expect(page.locator('main')).toBeVisible()
    },
  },
]

let browser: Browser
let port: number

test.beforeAll(async () => {
  // A free DevTools port per launch: a fixed one collides when another scan runs at the same time (a Stop-hook scan
  // in a second worktree, another worker's gate). Chromium then starts without its DevTools server and
  // `detect --cdp` would attach to the other browser and scan the other branch's page.
  port = await freePort()
  browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] })
})

test.afterAll(async () => {
  await browser?.close()
})

for (const { label, viewport, ...rest } of VIEWPORTS) {
  test.describe(`design detector at ${label}`, () => {
    for (const surface of SURFACES) {
      test(surface.name, async ({ baseURL }) => {
        const context = await browser.newContext({
          baseURL,
          viewport,
          locale: 'de-DE',
          ...('mobile' in rest ? { hasTouch: true, isMobile: true } : {}),
        })
        try {
          const page = await context.newPage()
          await surface.open(page, context)
          await settleAnimations(page)
          // A unique marker in the URL hash lets `--target` pick exactly this page.
          const marker = `detect-${test.info().testId}-${randomUUID()}`
          await page.evaluate(m => history.replaceState(history.state, '', `${location.pathname}${location.search}#${m}`), marker)

          const findings = await detect(port, marker)
          const known = KNOWN_FINDINGS.filter(k => k.surface === surface.name)
          const isKnown = (f: Finding, k: typeof known[number]) => f.antipattern === k.rule && (f.snippet ?? '').includes(k.snippet)
          const primary = findings.filter(f => !f.advisory && !known.some(k => isKnown(f, k)))
          const advisories = findings.filter(f => f.advisory)
          if (advisories.length > 0) {
            test.info().annotations.push({ type: 'advisory', description: advisories.map(format).join('\n') })
          }
          expect(primary.map(format), `Impeccable primary findings on ${surface.name} at ${label}`).toEqual([])
          const gone = known.filter(k => !findings.some(f => isKnown(f, k)))
          expect(gone.map(k => `#${k.issue} ${k.rule} ${k.snippet}`), 'known findings that no longer occur: remove them from KNOWN_FINDINGS').toEqual([])
        }
        finally {
          await context.close()
        }
      })
    }
  })
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port: free } = server.address() as { port: number }
      server.close(() => resolvePort(free))
    })
  })
}

function format(f: Finding): string {
  return `[${f.antipattern}] ${f.description}${f.snippet ? ` (${f.snippet.slice(0, 120)})` : ''}`
}

async function detect(cdpPort: number, target: string): Promise<Finding[]> {
  try {
    const { stdout } = await run(process.execPath, [CLI, 'detect', '--cdp', String(cdpPort), '--target', target, '--json'], { maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout) as Finding[]
  }
  catch (error) {
    // Exit 2 = primary findings, still valid JSON on stdout; anything else is an operational failure.
    const e = error as { code?: number, stdout?: string, stderr?: string }
    if (e.code === 2 && e.stdout) return JSON.parse(e.stdout) as Finding[]
    throw new Error(`impeccable detect --cdp failed (exit ${e.code}): ${e.stderr ?? String(error)}`, { cause: error })
  }
}
