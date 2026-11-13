/**
 * Visual regression tests — pixel-diff baselines for key board states.
 *
 * Purpose: Catch unintended look-and-feel drift introduced by agentic code changes.
 * All tests use deterministic seed data so snapshots are reproducible.
 *
 * Covers: desktop board, progress column, task detail, mobile 390px tabs, empty column
 * (rest + ghost), WIP-limit column (occupied + drag-over), drag overlay, focus states.
 * `settle()` waits for fonts + rendered icon SVGs so baselines never capture half-loaded icons.
 *
 * Core flows (#63, the diff basis for the UI kit refactor of epic #58), each at 1280 and 390, light: the guided new card
 * (title, a question, the Mehr list, saving), the day-close dialog and drawer, the new-day recap, /statistics (verdict and
 * one open tile), /trash (filled, empty), the Mehr panel, /settings and /settings/topics, the Notion setup wizard
 * (first and mapping step) and LocalSetupFlow on /welcome, the task sheet's add form, and the toast and UAlert notice
 * styles. Day-sensitive flows pin the page clock to `FIXED_NOW` and seed relative to it. These are macOS pixels; the
 * platform-independent CI coverage of the same surfaces is the `/ui` style fingerprint (epic #58, decision D3).
 *
 * Updating baselines (intentional UI change): `PORT=<free port> npm run test:e2e -- tests/e2e/visual-regression.spec.ts --update-snapshots` (a PORT that serves nothing: `reuseExistingServer` would otherwise record from a dev server on :3000)
 * and commit the updated PNGs in tests/e2e/snapshots/. The run is against the production build (#540, #541; production
 * is what ships), so never pass a `BASE_URL` that points at `nuxt dev`.
 * `nuxt dev` rasterises the 12 px `text-xs` labels (the yesterday note's "Gesehen" button, the task sheet's
 * property labels, the Mehr panel) about 1 px lower, so a run against the dev server can fail a few of these shots
 * by that glyph offset. Box geometry is identical in both modes. The gate and `npm run release` use the build only.
 */

import { test, expect, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test'
import { showColumnPage } from './helpers/dnd'
import { moreButton, openDayClose, openMore } from './helpers/appNav'
import { installClock, pinnedNow } from './helpers/clock'
import { emitDataStatus, installTauriStub } from './helpers/tauriStub'
import {
  seedDayRecapStore,
  seedLocalBoard,
  seedMixedBoard,
  seedTrash,
  trashTask,
  WORST_CASE_FOOTER_CARRY_OVER,
  WORST_CASE_FOOTER_ID,
  WORST_CASE_FOOTER_TASKS,
  type SeedCarryOver,
  type SeedTask,
} from './helpers/seed'

// Baselines in tests/e2e/snapshots/ are rendered on macOS (snapshotPathTemplate has no
// platform suffix), so font/antialiasing differences make them fail on the Linux CI runner.
// Skip in CI and in Linux cloud sessions; run locally (see "Updating baselines" above).
test.skip(
  !!process.env.CI || process.env.CLAUDE_CODE_REMOTE === 'true',
  'Visual baselines are macOS-rendered; not comparable on Linux CI or cloud sessions',
)

// Stable timestamp so dates in the UI don't cause spurious diffs
const FIXED_NOW = '2026-05-16T10:00:00.000Z'
const FIXED_YESTERDAY = '2026-05-15T10:00:00.000Z'

const SEED: SeedTask[] = [
  {
    id: 'vr-open-1',
    title: 'Konzept ausarbeiten',
    status: 0,
    priority: 2,
    activity: 'Planung',
    topic: 'Design',
    topicColorCode: '#6366f1',
    notes: 'Entwurf bis Ende der Woche fertigstellen.',
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
  {
    id: 'vr-open-2',
    title: 'Dokumentation lesen',
    status: 0,
    priority: 3,
    activity: null,
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 0,
    timeBoxSeconds: 2700,
    custom: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
  {
    // In-progress with half-used timebox — exercises the Jetzt progress bar (#388)
    id: 'vr-progress-1',
    title: 'Review schreiben',
    status: 1,
    priority: 1,
    activity: 'Entwicklung',
    topic: 'Backend',
    topicColorCode: '#10b981',
    timeSpentSeconds: 1800,
    timeBoxSeconds: 3600,
    custom: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
  {
    id: 'vr-waiting-1',
    title: 'Blocker klären',
    status: 2,
    priority: 2,
    activity: null,
    topic: null,
    topicColorCode: null,
    notes: 'Warte auf Rückmeldung vom Team.',
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
  {
    id: 'vr-done-1',
    title: 'Retrospektive nachbereiten',
    status: 3,
    priority: 3,
    activity: 'Planung',
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 3600,
    timeBoxSeconds: 3600,
    custom: {},
    completedAt: FIXED_YESTERDAY,
    createdAt: FIXED_YESTERDAY,
    updatedAt: FIXED_YESTERDAY,
  },
  {
    id: 'vr-done-2',
    title: 'CI Pipeline optimieren',
    status: 3,
    priority: 3,
    activity: null,
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 1800,
    timeBoxSeconds: 1800,
    custom: {},
    completedAt: FIXED_YESTERDAY,
    createdAt: FIXED_YESTERDAY,
    updatedAt: FIXED_YESTERDAY,
  },
]

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context, SEED)
})

/**
 * Waits until the page is visually settled: web fonts loaded and every Iconify icon
 * has rendered its SVG (icons load asynchronously; capturing earlier yields baselines
 * with empty chip chevrons/x icons), then lets one frame pass.
 */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => {
    // Loaded icons render as <svg class="iconify"> with path children; unresolved ones are
    // empty placeholders (an svg without children or a bare span)
    const icons = Array.from(document.querySelectorAll('.iconify'))
    return icons.every((el) => el.tagName.toLowerCase() === 'svg' && el.childElementCount > 0)
  })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test('board: full default state — all 4 columns', async ({ page }) => {
  await page.goto('/tasks')
  await expect(page.locator('#column-open-list')).toBeVisible()
  // Move mouse off-screen so no hover states bleed into the snapshot
  await page.mouse.move(0, 0)
  await expect(page).toHaveScreenshot('board-full.png')
})

test.describe('wide screen', () => {
  test.use({ viewport: { width: 2560, height: 1000 } })
  test('board: capped centred columns at 2560px', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list')).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(page).toHaveScreenshot('board-wide-2560.png')
  })
})

test('board: in-progress column with the Jetzt progress bar', async ({ page }) => {
  await page.goto('/tasks')
  const progressColumn = page.locator('#column-progress')
  await expect(progressColumn).toBeVisible()
  await page.mouse.move(0, 0)
  // Element screenshot keeps the snapshot tight and avoids other-column noise
  await expect(progressColumn).toHaveScreenshot('column-progress.png')
})

test('board: task detail page', async ({ page }) => {
  await page.goto('/tasks/vr-open-1')
  await expect(page.getByTestId('task-detail-header')).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('task-detail.png', { animations: 'disabled' })
})

// ---------------------------------------------------------------------------
// Mobile 390px, empty column, WIP limit, drag overlay (#68)
// ---------------------------------------------------------------------------

test.describe('mobile 390px board pages', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [index, label, file] of [
    [0, 'Offen', 'mobile-page-open.png'],
    [1, 'Jetzt', 'mobile-page-now.png'],
    [2, 'Erledigt', 'mobile-page-done.png'],
  ] as const) {
    test(`mobile: ${label} page`, async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.locator('.board')).toBeVisible()
      await showColumnPage(page, index)
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(file, { animations: 'disabled' })
    })
  }
})

/** Presses on `source`, moves past the drag threshold and on to (tx, ty); leaves the mouse down. */
async function dragTo(page: Page, source: Locator, tx: number, ty: number) {
  const box = (await source.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(cx + 10, cy + 10, { steps: 5 })
  await page.mouse.move(tx, ty, { steps: 20 })
  await expect(page.locator('.board')).toHaveClass(/dragging/)
  await expect(page.locator('.kando-dnd-preview')).toBeVisible()
  // Let the overlay and the column layout settle: wait until the overlay and the target
  // column hold the same rects for several consecutive frames (a fixed delay was flaky)
  await page.waitForFunction(() => {
    const w = window as unknown as { __dragRects?: { key: string; frames: number } }
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect()
      return r ? [r.x, r.y, r.width, r.height].map((n) => n.toFixed(1)).join(',') : ''
    }
    const key = [
      rect(document.querySelector('.kando-dnd-preview')),
      rect(document.querySelector('.kando-dnd-dragged')),
      rect(document.querySelector('.board')),
    ].join('|')
    const prev = w.__dragRects
    w.__dragRects = { key, frames: prev && prev.key === key ? prev.frames + 1 : 0 }
    return w.__dragRects.frames >= 10
  }, undefined, { polling: 'raf' })
}

/**
 * Full-page screenshot while a drag is in flight. The floating overlay is rotated 2deg, casts a
 * large shadow and follows the pointer, so its pixels vary between runs (sub-pixel offsets,
 * thousands of differing pixels; a mask is too tight for the shadow). It is hidden for the
 * comparison and asserted geometrically instead (centred horizontally on the target column);
 * everything else (placeholder, ghost, WIP column, neighbours) stays pixel-compared.
 */
async function expectDragScreenshot(page: Page, name: string, target: { x: number; width: number }) {
  const preview = (await page.locator('.kando-dnd-preview').boundingBox())!
  expect(preview.x + preview.width / 2).toBeCloseTo(target.x + target.width / 2, -1)
  const hide = await page.addStyleTag({ content: 'html .kando-dnd-preview { display: none !important; }' })
  await expect(page).toHaveScreenshot(name, { animations: 'disabled' })
  await hide.evaluate((el) => el.remove())
}

test('board: empty column at rest', async ({ page, context }) => {
  // Fresh init script after beforeEach: no waiting tasks, so the Wartet column is empty
  await seedLocalBoard(context, SEED.filter((t) => t.status !== 2))
  await page.goto('/tasks')
  await expect(page.locator('#column-waiting')).toBeVisible()
  await expect(page.locator('#column-waiting .task-wrapper')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await settle(page)
  // Full page: the empty column is intentionally blank, so its header must stay in frame
  await expect(page).toHaveScreenshot('column-empty.png', { animations: 'disabled' })
})

test('board: empty column ghost while dragging over it', async ({ page, context }) => {
  await seedLocalBoard(context, SEED.filter((t) => t.status !== 2))
  await page.goto('/tasks')
  await settle(page)
  const source = page.locator('#column-open-list .task-wrapper[data-task-id="vr-open-1"]')
  const target = (await page.locator('#column-waiting').boundingBox())!
  await dragTo(page, source, target.x + target.width / 2, target.y + 160)
  await expectDragScreenshot(page, 'column-empty-ghost.png', target)
  await page.mouse.up()
})

test('board: WIP limit - occupied In Arbeit column', async ({ page }) => {
  await page.goto('/tasks')
  const column = page.locator('#column-progress')
  await expect(column.locator('.task-wrapper')).toHaveCount(1)
  await page.mouse.move(0, 0)
  await settle(page)
  await expect(page).toHaveScreenshot('wip-limit-occupied.png', { animations: 'disabled' })
})

test('board: WIP limit - dragging a second task over the occupied column', async ({ page }) => {
  await page.goto('/tasks')
  await settle(page)
  const source = page.locator('#column-open-list .task-wrapper[data-task-id="vr-open-2"]')
  const target = (await page.locator('#column-progress').boundingBox())!
  await dragTo(page, source, target.x + target.width / 2, target.y + target.height / 2)
  await expectDragScreenshot(page, 'wip-limit-drag-over.png', target)
  await page.mouse.up()
  // Rejected: the progress column still holds exactly one task
  await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(1)
})

test('board: drag overlay mid-drag', async ({ page }) => {
  await page.goto('/tasks')
  await settle(page)
  const source = page.locator('#column-open-list .task-wrapper[data-task-id="vr-open-1"]')
  const target = (await page.locator('#column-waiting').boundingBox())!
  await dragTo(page, source, target.x + target.width / 2, target.y + 120)
  await expectDragScreenshot(page, 'drag-overlay.png', target)
  await page.mouse.up()
})

// ---------------------------------------------------------------------------
// Keyboard focus states (Nuxt UI 4.9+ unified focus halo)
// ---------------------------------------------------------------------------

/** Tab until `target` is focused (so :focus-visible applies); bounded to avoid endless loops. */
async function tabTo(page: Page, target: Locator, maxTabs = 60) {
  for (let i = 0; i < maxTabs; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Target was not reached via Tab')
}

test.describe('welcome page (kd#14)', () => {
  const shot = async (page: Page, name: string) => {
    await page.goto('/welcome')
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
    // The photo fades in over 700 ms once loaded: wait for the end state, not a timer
    await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '1')
    await settle(page)
    await expect(page).toHaveScreenshot(name)
  }

  test('photo and sheet (1280)', async ({ page }) => {
    await shot(page, 'welcome-1280.png')
  })

  test('photo strip above the sheet (390)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, 'welcome-390.png')
  })
})

test.describe('focus states', () => {
  test('focus: text input in task detail modal', async ({ page }) => {
    await page.goto('/tasks')
    await page.locator('.task[data-task-id="vr-open-1"]').click()
    const header = page.getByTestId('task-detail-header')
    await expect(header).toBeVisible()
    // The inline-editable display text is not keyboard-reachable (no tabindex), so enter edit
    // mode by click; the UInput then takes focus and text inputs always match :focus-visible.
    await header.getByText('Konzept ausarbeiten').click()
    const input = header.locator('input, textarea')
    await expect(input.first()).toBeFocused()
    await expect(header).toHaveScreenshot('focus-input-detail.png')
  })

  test('focus: primary button', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByRole('button', { name: 'Noch nirgends' }).click()
    // The local setup is page content now (#43). Park the pointer so the button shows its focus state, not hover
    await page.mouse.move(0, 0)
    const setup = page.getByTestId('local-setup-flow')
    const button = setup.locator('button.bg-primary').first()
    await expect(button).toBeVisible()
    await tabTo(page, button)
    await expect(button).toBeFocused()
    await expect(setup).toHaveScreenshot('focus-button-primary.png')
  })

  test('focus: task card', async ({ page }) => {
    await page.goto('/tasks')
    const card = page.locator('.task-wrapper[data-task-id="vr-open-1"]')
    await expect(card).toBeVisible()
    await tabTo(page, card, 30)
    // Clip around the card (plus margin) so the outline is included and not cut by the list bounds
    const box = (await card.boundingBox())!
    await expect(page).toHaveScreenshot('focus-task-card.png', {
      clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height * 2 + 24 },
    })
  })
})

/**
 * Done cards (#124): today's wins on the regular sheet with a struck title and the teal corner
 * check (a grey timebox chip with its fill kept, #388). Completed "now" so they count as today; the cards
 * show no dates, so the pixels stay stable.
 */
function seedWithTodaysWins(): SeedTask[] {
  const today = new Date().toISOString()
  const done = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title'>): SeedTask => ({
    status: 3, priority: 1, activity: null, topic: null, topicColorCode: null,
    timeSpentSeconds: 0, timeBoxSeconds: null, custom: {},
    completedAt: today, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, ...o,
  })
  return [
    ...SEED,
    done({ id: 'vr-today-1', title: 'Angebot schicken', activity: 'Vertrieb', priority: 3, timeSpentSeconds: 2400, timeBoxSeconds: 1800 }),
    done({ id: 'vr-today-2', title: 'Release-Notizen schreiben', topic: 'Doku' }),
  ]
}

test('board: Erledigt with done cards at rest', async ({ page, context }) => {
  await seedLocalBoard(context, seedWithTodaysWins())
  await page.goto('/tasks')
  await expect(page.locator('#column-done-list .task-wrapper')).toHaveCount(2)
  await page.mouse.move(0, 0)
  await settle(page)
  await expect(page.locator('#column-done')).toHaveScreenshot('column-done.png', { animations: 'disabled' })
})

test('board: Erledigt drop wash and landing slot while dragging over it', async ({ page, context }) => {
  await seedLocalBoard(context, seedWithTodaysWins())
  await page.goto('/tasks')
  await settle(page)
  const source = page.locator('#column-open-list .task-wrapper[data-task-id="vr-open-1"]')
  const target = (await page.locator('#column-done').boundingBox())!
  const firstWin = (await page.locator('#column-done-list .task-wrapper').first().boundingBox())!
  await dragTo(page, source, target.x + target.width / 2, firstWin.y + 10)
  await expect(page.locator('#column-done')).toHaveClass(/is-done-drop-target/)
  await expectDragScreenshot(page, 'done-drop-wash.png', target)
  await page.mouse.up()
})

// ---------------------------------------------------------------------------
// Stacks (#148): count caption, peek layers (1 for two cards, 2 for three or more), expanded
// header row with the pill and a round X. Offen grouped by topic with stacks of 2, 3 and 9.
// ---------------------------------------------------------------------------

const stackTask = (id: string, title: string, topic: string | null): SeedTask => ({
  id,
  title,
  status: 0,
  priority: 1,
  activity: null,
  topic,
  topicColorCode: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
})

const STACK_SEED: SeedTask[] = [
  stackTask('st-u1', 'Dokumentation lesen', null),
  ...[1, 2].map((n) => stackTask(`st-d${n}`, `Konzept ${n}`, 'Design')),
  ...[1, 2, 3].map((n) => stackTask(`st-b${n}`, `Schnittstelle ${n}`, 'Backend')),
  ...Array.from({ length: 9 }, (_, i) => stackTask(`st-o${i + 1}`, `Betrieb ${i + 1}`, 'Ops')),
  stackTask('st-s1', 'Einzelne Aufgabe', 'Solo'),
]

for (const [label, viewport, prefix] of [
  ['desktop', { width: 1280, height: 1200 }, 'stack'],
  ['mobile 390px', { width: 390, height: 1500 }, 'stack-mobile'],
] as const) {
  test.describe(`stacks: ${label}`, () => {
    test.use({ viewport })

    test.beforeEach(async ({ context, page }) => {
      await seedLocalBoard(context, STACK_SEED, {}, { enabled: true, key: 'topic' })
      await page.goto('/tasks')
      await expect(page.locator('#column-open-list .task-stack').first()).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
    })

    test('collapsed: stacks of 2, 3 and 9 with caption and peek layers', async ({ page }) => {
      await expect(page.locator('#column-open')).toHaveScreenshot(`${prefix}-collapsed.png`, { animations: 'disabled' })
    })

    test('expanded: header row, tight members, group gap', async ({ page }) => {
      await page.locator('#column-open-list .task-stack[data-stack-key="Backend"]').click()
      await expect(page.locator('#column-open-list .task-stack-header')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page.locator('#column-open')).toHaveScreenshot(`${prefix}-expanded.png`, { animations: 'disabled' })
    })
  })
}

// Sheet spotlight on stacks (#160): the stack fades as one unit, no peek card shows through.
for (const [label, viewport, name] of [
  ['desktop', { width: 1280, height: 1200 }, 'stack-spotlight.png'],
  ['mobile 390px', { width: 390, height: 1100 }, 'stack-spotlight-mobile.png'],
] as const) {
  test.describe(`stacks: sheet spotlight, ${label}`, () => {
    test.use({ viewport })

    test('collapsed stacks fade as one unit under the open sheet', async ({ page, context }) => {
      await seedLocalBoard(context, STACK_SEED, {}, { enabled: true, key: 'topic' })
      await page.goto('/tasks/st-s1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect.poll(() => page.locator('#column-open-list .task-stack[data-stack-key="Backend"]')
        .evaluate(el => getComputedStyle(el).opacity)).toBe('0.55')
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page.locator('#column-open')).toHaveScreenshot(name, { animations: 'disabled', mask: [page.getByRole('dialog')] })
    })
  })
}

// ---------------------------------------------------------------------------
// A whole collapsed stack in the air (#150): the source keeps one grey slot of the stack's
// footprint (front card greyed, layers and caption invisible). The floating overlay is hidden for the
// comparison like the card overlay above, and checked for the collapsed face.
// ---------------------------------------------------------------------------

test.describe('stacks: dragging a whole stack', () => {
  test.use({ viewport: { width: 1280, height: 1200 } })

  test('placeholder: one grey slot with the stack footprint', async ({ page, context }) => {
    await seedLocalBoard(context, STACK_SEED, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    const source = page.locator('#column-open-list .task-stack[data-stack-key="Backend"]')
    await expect(source).toBeVisible()
    await page.mouse.move(0, 0)
    await settle(page)
    const column = (await page.locator('#column-open').boundingBox())!
    await dragTo(page, source, column.x + column.width / 2, column.y + 360)
    const preview = page.locator('.kando-dnd-preview.task-stack')
    await expect(preview.locator('.task-stack__caption')).toHaveText('Backend3')
    await expect(preview.locator('.stacked-task--top')).toBeVisible()
    await expectDragScreenshot(page, 'stack-drag.png', column)
    await page.mouse.up()
  })
})

// ---------------------------------------------------------------------------
// Pending-sync marker and sync status (#319): Notion cannot be reached, one Notion task has unsaved changes.
// The cloud sits at the start of the card footer; the sync button shows the source's state and opens the popover.
// ---------------------------------------------------------------------------

test.describe('pending sync: Notion unreachable', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedMixedBoard(context)
    await context.addInitScript(() => {
      const raw = localStorage.getItem('tasks-store')
      if (raw) {
        const store = JSON.parse(raw) as { tasks: Array<{ id: string; pendingSync?: unknown }> }
        const pending = store.tasks.find((task) => task.id === 'page-1')
        if (pending) pending.pendingSync = { since: 1778925600000, attempts: 1, lastError: 'Network error' }
        localStorage.setItem('tasks-store', JSON.stringify(store))
      }
    })
    await page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))
  })

  const SHOTS = [
    { name: 'desktop', viewport: { width: 1280, height: 800 }, file: 'sync-pending' },
    { name: 'mobile 390px', viewport: { width: 390, height: 844 }, file: 'sync-pending-mobile' },
  ] as const

  for (const { name, viewport, file } of SHOTS) {
    test.describe(name, () => {
      test.use({ viewport })

      test('card cloud and the status dot on ⋯', async ({ page }) => {
        await page.goto('/tasks')
        await expect(page.locator('.task-wrapper', { hasText: 'Fokusaufgabe vorbereiten' }).getByTestId('task-save-pending')).toBeVisible()
        // The running Jetzt card queues its tracked time, which the offline source cannot take either
        await expect(page.locator('.task-wrapper', { hasText: 'Review Team Updates' }).getByTestId('task-save-pending')).toBeVisible()
        await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
        await page.mouse.move(0, 0)
        await settle(page)
        await expect(page).toHaveScreenshot(`${file}.png`, { animations: 'disabled' })
      })

      test('Mehr panel names the source and offers the repair', async ({ page }) => {
        await page.goto('/tasks')
        await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
        await expect(page.locator('.task-wrapper', { hasText: 'Review Team Updates' }).getByTestId('task-save-pending')).toBeVisible()
        const panel = await openMore(page)
        await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
        await settle(page)
        await expect(page).toHaveScreenshot(`${file}-panel.png`, { animations: 'disabled' })
      })
    })
  }
})

// ---------------------------------------------------------------------------
// Source icon in the card footer (#323): a board with Local and Notion tasks. One-source boards keep
// the baselines above untouched; these are the mixed-board ones.
// ---------------------------------------------------------------------------

const mixedVrTask = (task: Pick<SeedTask, 'id' | 'title' | 'status'> & Partial<SeedTask>): SeedTask => ({
  priority: 2,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  ...task,
})

// Done today: earlier days leave the Erledigt column
const MIXED_VR_TASKS: SeedTask[] = [
  mixedVrTask({ id: 'vr-n-open', title: 'Konzept ausarbeiten', status: 0, source: 'notion', externalId: 'vr-n-open', activity: 'Planung', topic: 'Design' }),
  mixedVrTask({ id: 'vr-l-open', title: 'Einkauf planen', status: 0, source: 'local', externalId: null, priority: 3, timeBoxSeconds: 2700 }),
  mixedVrTask({ id: 'vr-n-progress', title: 'Review schreiben', status: 1, source: 'notion', externalId: 'vr-n-progress', timeBoxSeconds: 3600, timeSpentSeconds: 1800 }),
  mixedVrTask({ id: 'vr-l-waiting', title: 'Antwort abwarten', status: 2, source: 'local', externalId: null }),
  mixedVrTask({ id: 'vr-n-done', title: 'Retrospektive nachbereiten', status: 3, source: 'notion', externalId: 'vr-n-done', completedAt: new Date().toISOString(), timeBoxSeconds: 1800, timeSpentSeconds: 1800 }),
  mixedVrTask({ id: 'vr-l-done', title: 'Wäsche erledigt', status: 3, source: 'local', externalId: null, completedAt: new Date().toISOString() }),
]

test.describe('mixed board: source icons (#323)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedMixedBoard(context, MIXED_VR_TASKS)
    await page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))
  })

  // The refused fetch puts the status dot on ⋯ whenever it lands, and a loaded machine lands it after the shot
  // (#364): capture only once ⋯ shows the settled state.
  const waitForOfflineSync = (page: Page) => expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')

  test('desktop: icon at the start of every card footer, Erledigt included', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('.task')).toHaveCount(MIXED_VR_TASKS.length)
    await expect(page.getByTestId('task-source-icon')).toHaveCount(MIXED_VR_TASKS.length)
    await waitForOfflineSync(page)
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('mixed-board.png', { animations: 'disabled' })
  })

  test.describe('mobile 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('Offen tab with icons', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.getByTestId('task-source-icon')).toHaveCount(MIXED_VR_TASKS.length)
      await showColumnPage(page, 0) // the board opens on Jetzt while a task sits there (kd#191)
      await waitForOfflineSync(page)
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot('mixed-board-mobile-open.png', { animations: 'disabled' })
    })
  })
})

test.describe('worst-case card footer (#323)', () => {
  for (const { name, viewport, file } of [
    { name: 'desktop', viewport: { width: 1280, height: 800 }, file: 'worst-case-footer.png' },
    { name: 'mobile 390px', viewport: { width: 390, height: 844 }, file: 'worst-case-footer-mobile.png' },
  ] as const) {
    test.describe(name, () => {
      test.use({ viewport })

      test('timebox chip, source icon and cloud, 6+ carry-over dots, priority', async ({ context, page }) => {
        await seedMixedBoard(context, WORST_CASE_FOOTER_TASKS, { carryOverByTaskId: WORST_CASE_FOOTER_CARRY_OVER })
        await page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))
        await page.goto('/tasks')
        const card = page.locator(`.task[data-task-id="${WORST_CASE_FOOTER_ID}"]`)
        await expect(card.getByTestId('task-save-pending')).toBeVisible()
        await expect(card.getByTestId('carry-over-dots')).toBeVisible()
        await page.mouse.move(0, 0)
        await settle(page)
        await expect(card).toHaveScreenshot(file, { animations: 'disabled' })
      })
    })
  }
})

// ---------------------------------------------------------------------------
// Jetzt focus overlay (#394). Seeds turn it off, so the baselines above show the plain board; these opt in.
// No `page.mouse.move`: a real pointer move hides the overlay, which is the whole point of the lamp.
// ---------------------------------------------------------------------------

test.describe('focus overlay on (#394)', () => {
  const overlayOn = async (page: Page) => {
    await expect(page.getByTestId('focus-overlay')).toHaveClass(/is-on/)
    await expect(page.getByTestId('focus-overlay').locator('.focus-overlay__tint')).toHaveCSS('opacity', '1')
    await settle(page)
  }

  test('desktop 1280: warm pool around the Now card, the rest dimmed and blurred', async ({ context, page }) => {
    await seedLocalBoard(context, SEED, {}, undefined, { focus: true })
    await page.goto('/tasks')
    await overlayOn(page)
    await expect(page).toHaveScreenshot('board-focus-overlay.png', { animations: 'disabled' })
  })

  test.describe('mobile 390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('Jetzt page: the pool follows the card, the app bar stays lit', async ({ context, page }) => {
      await seedLocalBoard(context, SEED, {}, undefined, { focus: true })
      await page.goto('/tasks')
      await expect(page.locator('.board')).toBeVisible()
      await showColumnPage(page, 1)
      await overlayOn(page)
      await expect(page).toHaveScreenshot('mobile-page-now-focus-overlay.png', { animations: 'disabled' })
    })
  })

  test('Einstellungen page: the tab strip over the Fokus row', async ({ context, page }) => {
    await seedLocalBoard(context, SEED, {}, undefined, { focus: true })
    await page.goto('/settings')
    await expect(page.getByTestId('focus-switch')).toBeVisible()
    await expect(page.getByTestId('settings-tabs')).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('settings-page.png', { animations: 'disabled' })
  })
})

// ---------------------------------------------------------------------------
// Core flows before the UI kit refactor (#63). Each shot: 1280 and 390, light, deterministic.
// Day-sensitive flows run on the page clock pinned to PINNED (it keeps ticking, timers fire) and are seeded
// relative to it, never to the Node clock, so the pixels do not depend on the day the suite runs.
// ---------------------------------------------------------------------------

const CORE_VIEWPORTS = [
  { size: '1280', viewport: { width: 1280, height: 900 } },
  { size: '390', viewport: { width: 390, height: 844 } },
] as const

/** The pinned instant: local noon of the shared test day (`helpers/clock.ts`, #449), so day buckets hold in every time zone. */
const PINNED = pinnedNow()
const PINNED_ISO = PINNED.toISOString()

/** Starts the page clock at `PINNED` and keeps it ticking; call before the seed and before `goto`. */
const pinClockToFixedNow = (context: BrowserContext) => installClock(context, { pinned: true })

/** Local time on the calendar day `daysAgo` before PINNED. */
const localAt = (daysAgo: number, hour: number, minute = 0) =>
  new Date(PINNED.getFullYear(), PINNED.getMonth(), PINNED.getDate() - daysAgo, hour, minute).toISOString()

/** `YYYY-MM-DD` (local) of the day `daysAgo` before PINNED_ISO, the format of the stores' day keys. */
const dayKeyAgo = (daysAgo: number) => {
  const d = new Date(PINNED.getFullYear(), PINNED.getMonth(), PINNED.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const carriedFor = (days: number): SeedCarryOver => ({ firstOn: dayKeyAgo(days), days, lastOn: dayKeyAgo(0), keptAtDays: null })

const coreTask = (task: Pick<SeedTask, 'id' | 'title' | 'status'> & Partial<SeedTask>): SeedTask => ({
  priority: 3,
  activity: null,
  topic: null,
  topicColorCode: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: localAt(1, 10),
  updatedAt: PINNED_ISO,
  ...task,
})

// --- Guided new card (#649, kd#16) ----------------------------------------

/** More than three topics and activities, so the Mehr cell has a list behind the three pills (kd#16). */
const NEW_CARD_SEED: SeedTask[] = [
  ...SEED,
  ...['Marketing:Recherche', 'Büro:Abstimmung', 'Vertrieb:Telefonat', 'Finanzen:Auswertung'].map((pair, index) => {
    const [topic, activity] = pair.split(':')
    return coreTask({ id: `vr-rich-${index}`, title: `Reich ${index}`, status: 2, topic, activity })
  }),
]

for (const { size, viewport } of CORE_VIEWPORTS) {
  test.describe(`new card (${size})`, () => {
    test.use({ viewport })

    const openCard = async (page: Page) => {
      await page.goto('/tasks')
      await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible()
      await showColumnPage(page, 0) // the board opens on Jetzt while a task sits there (kd#191)
      await page.locator('#column-open [data-testid="add-task-header-button"]').click()
      await expect(page.getByTestId('new-card-title')).toBeFocused()
    }
    const toQuestion = async (page: Page) => {
      await page.getByTestId('new-card-title').fill('Angebot schreiben')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('new-card-options')).toBeVisible()
    }
    const shot = async (page: Page, name: string) => {
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page.locator('#column-open')).toHaveScreenshot(name, { animations: 'disabled' })
    }

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context, NEW_CARD_SEED)
    })

    test('title step', async ({ page }) => {
      await openCard(page)
      await page.getByTestId('new-card-title').fill('Angebot schreiben')
      await shot(page, `new-card-title-${size}.png`)
    })

    test('one question step', async ({ page }) => {
      await openCard(page)
      await toQuestion(page)
      await shot(page, `new-card-question-${size}.png`)
    })

    test('Mehr list', async ({ page }) => {
      await openCard(page)
      await toQuestion(page)
      await page.getByTestId('new-card-more').click()
      await expect(page.getByTestId('new-card-more-list')).toBeVisible()
      await expect(page.getByTestId('new-card-search')).toBeFocused()
      await shot(page, `new-card-more-${size}.png`)
    })

    test('saving', async ({ context, page }) => {
      // A Notion default source: the card rests in `is-saving` while the create call is held
      // No Jetzt task at 390, so the board opens on Offen (kd#191): a swipe there would give the refused sync time to mark the source
      // unreachable, and an unreachable source queues the task without the create call this state waits in
      await seedMixedBoard(context, size === '390' ? MIXED_VR_TASKS.filter(task => task.status !== 1) : MIXED_VR_TASKS)
      const held: Route[] = []
      // Only create-task is held. The schema reads go through to the stub and every other call (the task query) hangs: it must
      // not answer, so the stub never swaps the seeded rows (#364), and it must not be refused either: a refused call marks the
      // source unreachable ~1.3 s after the load, and a task saved after that queues without the create call (a race the flow lost)
      const hung: Route[] = []
      await page.route('**/api/notion/**', (route) => {
        if (/\/api\/notion\/(database|data-sources)\?/.test(route.request().url())) return route.continue()
        hung.push(route)
      })
      await page.route('**/api/notion/create-task', (route) => { held.push(route) })
      await openCard(page)
      await toQuestion(page)
      // Cmd/Ctrl+Enter saves from any step
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.getByTestId('new-card-flow')).toHaveClass(/is-saving/)
      await expect.poll(() => held.length).toBe(1)
      await shot(page, `new-card-saving-${size}.png`)
      await page.unroute('**/api/notion/create-task', { behavior: 'ignoreErrors' })
      await page.unroute('**/api/notion/**', { behavior: 'ignoreErrors' })
    })
  })
}

// --- Day close (#98): dialog at 1280, drawer at 390 -------------------------

/** Done today at `h` hours before PINNED_ISO, so the day-close summary has a stable order and times. */
const doneHoursAgo = (h: number) => new Date(PINNED.getTime() - h * 3_600_000).toISOString()

const DAY_CLOSE_SEED: SeedTask[] = [
  coreTask({ id: 'dc-done-1', title: 'Angebot an Kunden schicken', status: 3, priority: 2, activity: 'Planung', timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: doneHoursAgo(1) }),
  coreTask({ id: 'dc-done-2', title: 'Steuerunterlagen sortieren', status: 3, timeSpentSeconds: 2700, timeBoxSeconds: 3600, completedAt: doneHoursAgo(2) }),
  coreTask({ id: 'dc-done-3', title: 'Kurze Rückfrage beantwortet (ohne erfasste Zeit)', status: 3, completedAt: doneHoursAgo(3) }),
  coreTask({ id: 'dc-done-4', title: 'Sehr langer Aufgabentitel, der in der Zusammenfassung sauber umbrechen muss, ohne die Zeile zu sprengen oder die Zeit zu verdrängen', status: 3, timeSpentSeconds: 1200, timeBoxSeconds: 1200, completedAt: doneHoursAgo(4) }),
  coreTask({ id: 'dc-done-old', title: 'Gestern erledigt', status: 3, timeSpentSeconds: 900, completedAt: localAt(1, 15) }),
  coreTask({ id: 'dc-progress-1', title: 'Präsentation vorbereiten', status: 1, priority: 1, activity: 'Entwicklung', topic: 'Backend', topicColorCode: '#10b981', timeSpentSeconds: 1800, timeBoxSeconds: 3600 }),
  coreTask({ id: 'dc-open-stale', title: 'Steuerberater anrufen', status: 0, priority: 2 }),
  coreTask({ id: 'dc-open-oldest', title: 'Altes Thema endlich klären', status: 0 }),
  coreTask({ id: 'dc-open-fresh', title: 'Neue Idee notieren', status: 0, createdAt: PINNED_ISO }),
  coreTask({ id: 'dc-waiting-stale', title: 'Rückmeldung vom Vermieter', status: 2, priority: 2 }),
]

for (const { size, viewport } of CORE_VIEWPORTS) {
  test(`day close: ${size === '1280' ? 'dialog' : 'drawer'} (${size})`, async ({ context, page }) => {
    await page.setViewportSize(viewport)
    await pinClockToFixedNow(context)
    await seedLocalBoard(context, DAY_CLOSE_SEED, {
      'dc-open-stale': carriedFor(5),
      'dc-open-oldest': carriedFor(9),
      'dc-waiting-stale': carriedFor(6),
    })
    await page.goto('/tasks')
    await expect(page.locator('#column-done-list .task-wrapper').first()).toBeVisible()
    await openDayClose(page)
    const dialog = page.getByRole('dialog', { name: 'Tag abschließen' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('day-close-bar')).toBeVisible()
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot(`day-close-${size}.png`, { animations: 'disabled' })
  })
}

// --- New-day recap (#385) ---------------------------------------------------

const RECAP_SEED: SeedTask[] = [
  coreTask({ id: 'nd-done-1', title: 'Angebot an Kunden schicken', status: 3, priority: 2, activity: 'Planung', timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: localAt(1, 11, 15) }),
  coreTask({ id: 'nd-done-2', title: 'Kurze Rückfrage beantwortet', status: 3, completedAt: localAt(1, 13) }),
  coreTask({ id: 'nd-done-3', title: 'Steuerunterlagen sortieren', status: 3, timeSpentSeconds: 2700, completedAt: localAt(1, 14, 30) }),
  coreTask({ id: 'nd-done-4', title: 'Retrospektive nachbereiten', status: 3, activity: 'Planung', timeSpentSeconds: 3600, timeBoxSeconds: 3600, completedAt: localAt(1, 15, 45) }),
  coreTask({ id: 'nd-open-1', title: 'Konzept ausarbeiten', status: 0, priority: 2, activity: 'Planung', topic: 'Design', topicColorCode: '#6366f1', timeBoxSeconds: 2700 }),
  coreTask({ id: 'nd-waiting-1', title: 'Rückmeldung vom Vermieter', status: 2, priority: 2 }),
]

for (const { size, viewport } of CORE_VIEWPORTS) {
  test(`new-day recap: stage (${size})`, async ({ context, page }) => {
    await page.setViewportSize(viewport)
    await pinClockToFixedNow(context)
    await seedLocalBoard(context, RECAP_SEED, { 'nd-open-1': carriedFor(2), 'nd-waiting-1': carriedFor(3) }, undefined, { once: true })
    await seedDayRecapStore(context, { lastShownDay: dayKeyAgo(2), once: true })
    await page.goto('/tasks')
    const recap = page.getByTestId('new-day-recap')
    await expect(recap).toBeVisible()
    await expect(page.getByTestId('recap-summary')).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    await expect(page.getByTestId('recap-continue')).toBeFocused()
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot(`new-day-recap-${size}.png`, { animations: 'disabled' })
  })
}

// --- Statistics (#469, #600): verdict and one open tile ---------------------

/** Completion records, 20 baseline tasks over four weeks (half over the timebox) and four recent ones, dated in the browser (pinned clock). */
async function seedStatistics(context: BrowserContext) {
  await context.addInitScript(() => {
    const day = (ago: number, minute: number) => {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 10, minute).toISOString()
    }
    const record = (index: number, ago: number, accuracy: number, topic: string) => ({
      taskId: `vr-rec-${index}`,
      title: `Aufgabe ${index}`,
      completedAt: day(ago, index % 50),
      timeBoxSeconds: 1800,
      actualTimeSpentSeconds: Math.round(18 * accuracy),
      estimationAccuracy: accuracy,
      topic,
      topicColorCode: null,
      activity: 'Büro',
      isUnplanned: false,
    })
    const baseline = Array.from({ length: 20 }, (_, i) => record(i, i === 0 ? 34 : 8 + (i % 26), i % 2 ? 150 : 100, i % 2 ? 'Büro' : 'Feld'))
    const current = Array.from({ length: 4 }, (_, i) => record(20 + i, i, 100, 'Büro'))
    localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords: [...baseline, ...current] }))
  })
}

for (const { size, viewport } of CORE_VIEWPORTS) {
  test(`statistics: verdict and one open tile (${size})`, async ({ context, page }) => {
    await page.setViewportSize(viewport)
    await pinClockToFixedNow(context)
    await seedLocalBoard(context, SEED)
    await seedStatistics(context)
    await page.goto('/statistics')
    await expect(page.getByTestId('stats-verdict')).toBeVisible()
    await page.getByTestId('stats-tile-2-toggle').click()
    await expect(page.getByTestId('stats-tile-2-toggle')).toHaveAttribute('aria-expanded', 'true')
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot(`statistics-${size}.png`, {
      animations: 'disabled',
      fullPage: true,
      // The floating app bar lands at a different height in a full-page capture from run to run (301 px at 390)
      mask: [page.getByTestId('app-nav')],
    })
  })
}

// --- Trash (#422): filled, empty --------------------------------------------

for (const { size, viewport } of CORE_VIEWPORTS) {
  test.describe(`trash (${size})`, () => {
    test.use({ viewport })

    test('filled: Heute, Gestern, Früher', async ({ context, page }) => {
      await pinClockToFixedNow(context)
      await seedLocalBoard(context, SEED)
      await seedTrash(context, [
        { task: trashTask('vr-trash-1', 'Angebot überarbeiten', 0), deletedAt: PINNED.getTime() - 210_000 },
        { task: trashTask('vr-trash-2', 'Alte Notiz', 2), deletedAt: PINNED.getTime() - 5 * 3_600_000 },
        { task: trashTask('vr-trash-3', 'Doppelter Eintrag', 3), deletedAt: new Date(localAt(1, 16)).getTime() },
        { task: trashTask('vr-trash-4', 'Idee verworfen', 0), deletedAt: new Date(localAt(9, 9)).getTime() },
      ])
      await page.goto('/trash')
      await expect(page.getByTestId('trash-page')).toBeVisible()
      await expect(page.getByTestId('trash-empty')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`trash-filled-${size}.png`, { animations: 'disabled' })
    })

    test('empty', async ({ page }) => {
      await page.goto('/trash')
      await expect(page.getByTestId('trash-empty-state')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`trash-empty-${size}.png`, { animations: 'disabled' })
    })
  })
}

// --- Mehr panel, settings ---------------------------------------------------

for (const { size, viewport } of CORE_VIEWPORTS) {
  test.describe(`app bar and settings (${size})`, () => {
    test.use({ viewport })

    test('Mehr panel', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.locator('#column-open')).toBeVisible()
      await openMore(page)
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`more-panel-${size}.png`, { animations: 'disabled' })
    })

    test('/settings', async ({ page }) => {
      await page.goto('/settings')
      await expect(page.getByTestId('settings-tabs')).toBeVisible()
      await expect(page.getByTestId('focus-switch')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`settings-board-${size}.png`, { animations: 'disabled' })
    })

    test('/settings/topics', async ({ page }) => {
      await page.goto('/settings/topics')
      await expect(page.getByTestId('topics-panel')).toBeVisible()
      await expect(page.getByTestId('topics-row').first()).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`settings-topics-${size}.png`, { animations: 'disabled' })
    })
  })
}

// --- Setup flows on /welcome: Notion wizard (stub) and LocalSetupFlow -------

for (const { size, viewport } of CORE_VIEWPORTS) {
  test.describe(`setup flows (${size})`, () => {
    test.use({ viewport })

    test('Notion wizard: first step', async ({ page }) => {
      await page.goto('/welcome')
      await page.getByTestId('welcome-choice-notion').click()
      await expect(page.getByRole('heading', { name: 'Notion-Token' })).toBeFocused()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`notion-wizard-token-${size}.png`, { animations: 'disabled' })
    })

    test('Notion wizard: a mapping step', async ({ page }) => {
      await page.goto('/welcome')
      await page.getByTestId('welcome-choice-notion').click()
      const flow = page.getByTestId('notion-setup-flow')
      const proceed = page.getByTestId('wizard-proceed')
      await flow.getByPlaceholder('Integrationstoken eingeben').fill('notion_test_stub')
      // Token and database validate against the stub; the properties step enables "Weiter" once the schema is auto-mapped
      for (let press = 0; press < 2; press++) {
        const before = await flow.locator('[aria-current="step"]').first().innerText()
        await expect(proceed).toBeEnabled()
        await proceed.click()
        await expect(flow.locator('[aria-current="step"]').first()).not.toHaveText(before, { useInnerText: true })
      }
      await expect(proceed).toBeEnabled()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`notion-wizard-mapping-${size}.png`, { animations: 'disabled' })
    })

    test('LocalSetupFlow', async ({ page }) => {
      await page.goto('/welcome')
      await page.getByTestId('welcome-choice-local').click()
      await expect(page.getByTestId('local-confirm')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`local-setup-${size}.png`, { animations: 'disabled' })
    })

    test('SamplesSetupFlow (#236)', async ({ page }) => {
      await page.goto('/welcome')
      await page.getByTestId('welcome-choice-samples').click()
      await expect(page.getByTestId('samples-confirm')).toBeVisible()
      await page.mouse.move(0, 0)
      await settle(page)
      await expect(page).toHaveScreenshot(`samples-setup-${size}.png`, { animations: 'disabled' })
    })
  })
}

// --- Task sheet add form ----------------------------------------------------

for (const { size, viewport } of CORE_VIEWPORTS) {
  test(`task sheet: add form (${size})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/tasks/add')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(page.getByPlaceholder('Aufgabe benennen…')).toBeFocused()
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot(`task-add-form-${size}.png`, { animations: 'disabled' })
  })
}

// --- Notice styles: the undo toast and the UAlert of the data notice --------

for (const { size, viewport } of CORE_VIEWPORTS) {
  test(`toast: undo after completing a card (${size})`, async ({ context, page }) => {
    await page.setViewportSize(viewport)
    await pinClockToFixedNow(context)
    await seedLocalBoard(context, SEED)
    await page.goto('/tasks')
    if (size === '390') await showColumnPage(page, 0)
    // Settle before the action: once the toast shows, the five second window runs and the clock must be paused at once
    await settle(page)
    await page.mouse.move(0, 0)
    await page.locator('.task-wrapper', { hasText: 'Dokumentation lesen' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Status ändern' }).click()
    await page.getByRole('menuitem', { name: 'Erledigt', exact: true }).click()
    // The toast's wrapper slot holds the text and the undo button; its parent is the card
    const toast = page.locator('[data-slot="wrapper"]').filter({ hasText: 'Rückgängig' }).last().locator('xpath=..')
    await expect(toast).toBeVisible()
    await expect(page.getByTestId('completion-burst')).toHaveCount(0)
    // The undo window is five seconds: freeze the page's timers right away so the toast stays for the comparison, with
    // a margin far above one round trip. A paused clock stalls the page's rAF, which the element screenshot's
    // stability check waits on, so shoot the page. The countdown bar at the bottom edge depends on the elapsed time: masked
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000))
    await expect(page).toHaveScreenshot(`toast-undo-${size}.png`, {
      animations: 'disabled',
      mask: [toast.locator('[data-slot="progress"]')],
    })
  })
}

const CONFIG_FOLDER = '/Users/test/Library/Application Support/io.github.jaylouiz.kan-do'

for (const { size, viewport } of CORE_VIEWPORTS) {
  test.describe(`UAlert: data notice (${size})`, () => {
    test.use({ viewport })

    for (const [status, label, extra] of [
      ['missing-file', 'warning', {}],
      ['write-failed', 'error', { error: 'No space left on device' }],
    ] as const) {
      test(`${label}`, async ({ context, page }) => {
        await installTauriStub(context, {
          data: {
            folder: CONFIG_FOLDER,
            envelope: { schemaVersion: 2, writtenAt: '2026-05-16T09:12:00.000Z', writtenBy: 'other-device', appVersion: '0.1.0', stores: { 'tasks-store': { tasks: [] } } },
          },
        })
        await page.goto('/settings/data')
        await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
        await emitDataStatus(page, { status, ...extra })
        const notice = page.getByTestId('data-storage-notice')
        await expect(notice).toBeVisible()
        await page.mouse.move(0, 0)
        await settle(page)
        await expect(notice).toHaveScreenshot(`notice-${label}-${size}.png`, { animations: 'disabled' })
      })
    }
  })
}
