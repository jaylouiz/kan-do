import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { showColumnPage } from './helpers/dnd'

/**
 * "Gestern erledigt" note (#63, #605): tasks finished before today appear as one line on a soft Done-Teal
 * surface at the top of Erledigt; the label opens the titles in place; "Gesehen" archives them (no toast, #463),
 * titles open the task sheet.
 */

const DAY_MS = 86_400_000

function doneTask(id: string, title: string, completedAt: Date): SeedTask {
  const iso = completedAt.toISOString()
  return {
    id,
    title,
    status: 3,
    priority: 1,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    custom: {},
    completedAt: iso,
    createdAt: iso,
    updatedAt: iso,
  }
}

/** Today at noon and N previous tasks, finished at noon `daysAgo` days before today. */
function board(previousCount: number, daysAgo = 1): SeedTask[] {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const previous = new Date(today.getTime() - daysAgo * DAY_MS)
  const tasks = [doneTask('done-today-1', 'Heute erledigt', today)]
  for (let i = 1; i <= previousCount; i++) {
    tasks.push(doneTask(`done-prev-${i}`, `Gestern Aufgabe ${i}`, new Date(previous.getTime() + i * 60_000)))
  }
  return tasks
}

const note = (page: Page) => page.locator('#column-done .yesterday-note')
/** The note is one collapsed line; the titles exist only after the label button opened it (#605). */
const openNote = async (page: Page) => {
  const toggle = note(page).getByTestId('yesterday-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}
const archivedIds = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { archivedTaskIds?: string[] }).archivedTaskIds ?? [])

/** The former "Schön gemacht" / "{n} erledigte Aufgaben abgelegt" toast with "Rückgängig" is gone (#463). */
async function expectNoArchiveToast(page: Page) {
  await expect(page.getByText('Schön gemacht')).toHaveCount(0)
  await expect(page.getByText(/erledigte Aufgaben? abgelegt/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)
}

test.describe('Yesterday note', () => {
  test('renders as one collapsed line on a Done-Teal surface: label, count, one action, no titles', async ({ page, context }) => {
    await seedLocalBoard(context, board(5))
    await page.goto('/tasks')

    await expect(note(page)).toBeVisible()
    await expect(note(page).getByRole('heading', { name: /Gestern erledigt.*5/ })).toBeVisible()
    await expect(note(page).getByTestId('yesterday-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(note(page).locator('li')).toHaveCount(0)
    // No task cards, no statistics button inside the section
    await expect(note(page).locator('.task')).toHaveCount(0)
    await expect(note(page).getByRole('button', { name: /Statistik/ })).toHaveCount(0)
    await expect(note(page).getByRole('button', { name: /^Gesehen/ })).toHaveCount(1)
    const surface = await note(page).locator('.yesterday-note__surface').evaluate((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { border: s.borderTopWidth, bg: getComputedStyle(el, '::before').backgroundColor, height: r.height } // the wash is the notice's ::before (#293)
    })
    expect(surface.border).toBe('0px') // no outline (#57)
    expect(surface.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(surface.height).toBe(48)
  })

  test('the label opens up to five titles with time spent, then "+ n weitere"; it closes again', async ({ page, context }) => {
    const tasks = board(7)
    tasks.find((t) => t.id === 'done-prev-1')!.timeSpentSeconds = 45 * 60
    await seedLocalBoard(context, tasks)
    await page.goto('/tasks')
    const toggle = note(page).getByTestId('yesterday-toggle')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(note(page).locator('.yesterday-note__title')).toHaveCount(5)
    await expect(note(page).getByText('+ 2 weitere')).toBeVisible()
    await expect(note(page).getByRole('button', { name: /Gestern Aufgabe 1/ })).toContainText('45 min')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(note(page).locator('li')).toHaveCount(0)
  })

  test('one task done yesterday: the same line, one row when opened', async ({ page, context }) => {
    await seedLocalBoard(context, board(1))
    await page.goto('/tasks')
    await openNote(page)
    await expect(note(page).locator('.yesterday-note__title')).toHaveCount(1)
    await expect(note(page).getByText(/weitere/)).toHaveCount(0)
  })

  test('uses the weekday label for older groups and "Zuletzt" beyond six days', async ({ page, context }) => {
    await seedLocalBoard(context, board(1, 3))
    await page.goto('/tasks')
    const weekday = new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(new Date(Date.now() - 3 * DAY_MS))
    await expect(note(page).getByRole('heading', { name: new RegExp(`${weekday} erledigt`) })).toBeVisible()
  })

  test('uses "Zuletzt erledigt" for groups older than six days', async ({ page, context }) => {
    await seedLocalBoard(context, board(2, 9))
    await page.goto('/tasks')
    await expect(note(page).getByRole('heading', { name: /Zuletzt erledigt/ })).toBeVisible()
  })

  test('renders nothing without previous tasks', async ({ page, context }) => {
    await seedLocalBoard(context, board(0))
    await page.goto('/tasks')
    await expect(page.locator('#column-done')).toBeVisible()
    await expect(page.locator('.yesterday-note')).toHaveCount(0)
  })

  test('Gesehen archives every previous task and shows no toast', async ({ page, context }) => {
    await seedLocalBoard(context, board(5))
    await page.goto('/tasks')
    await expect(note(page)).toBeVisible()

    await note(page).getByRole('button', { name: /^Gesehen, 5 erledigte Aufgaben ablegen$/ }).click()

    await expect(note(page)).toHaveCount(0)
    // The tasks are archived, and nothing announces it
    await expect.poll(() => archivedIds(page)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5].map(i => `done-prev-${i}`)))
    expect(await archivedIds(page)).not.toContain('done-today-1')
    await expectNoArchiveToast(page)
    // Focus never drops to <body>: it lands on the Erledigt list
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('#column-done') !== null)).toBe(true)
    await expect(page.getByText('Heute erledigt')).toBeVisible()
  })

  test('390px: focus never drops to <body> after Gesehen, and no toast', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedLocalBoard(context, board(2))
    await page.goto('/tasks')
    await showColumnPage(page, 2) // Gesehen sits on the Erledigt page; the tabs are gone (#470)
    const inDone = () => page.evaluate(() => document.activeElement?.closest('#column-done') !== null)
    await expect(note(page)).toBeVisible()
    await note(page).getByRole('button', { name: /^Gesehen/ }).click()
    await expect(note(page)).toHaveCount(0)
    await expect.poll(inDone).toBe(true)
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true)
    await expectNoArchiveToast(page)
  })

  test('with no wins today, focus moves to the column heading', async ({ page, context }) => {
    await seedLocalBoard(context, board(2).filter((t) => t.id !== 'done-today-1'))
    await page.goto('/tasks')
    await note(page).getByRole('button', { name: /^Gesehen/ }).click()
    await expect(note(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H2')
  })

  test('archived tasks stay away after a reload', async ({ page, context }) => {
    await seedLocalBoard(context, board(2))
    await page.goto('/tasks')
    await note(page).getByRole('button', { name: /^Gesehen/ }).click()
    await expect(note(page)).toHaveCount(0)
    await page.waitForTimeout(300)

    // addInitScript re-seeds the original state on reload, so assert on the persisted store instead
    const archived = await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}').archivedTaskIds)
    expect(archived).toEqual(expect.arrayContaining(['done-prev-1', 'done-prev-2']))
  })

  test('a title opens the task sheet and focus returns to it on close', async ({ page, context }) => {
    await seedLocalBoard(context, board(2))
    await page.goto('/tasks')
    await openNote(page)
    const title = note(page).getByRole('button', { name: 'Gestern Aufgabe 1' })
    await title.click()
    await expect(page).toHaveURL(/\/tasks\/done-prev-1/)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(title).toBeFocused()
  })

  test('a title opens via keyboard Enter', async ({ page, context }) => {
    await seedLocalBoard(context, board(1))
    await page.goto('/tasks')
    await openNote(page)
    await note(page).getByRole('button', { name: 'Gestern Aufgabe 1' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/tasks\/done-prev-1/)
  })

  test('title targets are at least 24px tall and do not overlap', async ({ page, context }) => {
    await seedLocalBoard(context, board(4))
    await page.goto('/tasks')
    await openNote(page)
    await expect(note(page).locator('li')).toHaveCount(4)
    const boxes = await note(page).locator('.yesterday-note__title').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, height: r.height })))
    expect(boxes).toHaveLength(4)
    for (const [i, b] of boxes.entries()) {
      expect(b.height).toBeGreaterThanOrEqual(24)
      if (i > 0) expect(b.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom)
    }
  })

  test('title rows reach the 44px touch floor at 390 (#71)', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedLocalBoard(context, board(3))
    await page.goto('/tasks')
    await showColumnPage(page, 2)
    await openNote(page)
    const heights = await note(page).locator('.yesterday-note__title').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height))
    expect(heights).toHaveLength(3)
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44)
  })

  test('the note does not resize while dragging', async ({ page, context }) => {
    await seedLocalBoard(context, board(4))
    await page.goto('/tasks')
    const before = await note(page).boundingBox()
    await page.evaluate(() => document.querySelector('.board')?.classList.add('dragging'))
    const during = await note(page).boundingBox()
    expect(during).toEqual(before)
  })
})

test.describe('Yesterday note width', () => {
  // The note takes the box of a card (.task, not its sortable wrapper): same left edge and width at every
  // viewport (390 phone, 900 tablet where the md inset meets a narrow column, 1280 desktop)
  for (const width of [390, 900, 1280]) {
    test(`${width}px: the note has the width and edges of the cards below it`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'de-DE' })
      await seedLocalBoard(context, board(2))
      const page = await context.newPage()
      await page.goto('/tasks')
      if (width < 768) await showColumnPage(page, 2)
      const card = page.locator('#column-done [data-task-id="done-today-1"] .task').first()
      await expect(card).toBeVisible()
      await page.waitForTimeout(400)
      const surface = (await note(page).locator('.yesterday-note__surface').boundingBox())!
      const cardBox = (await card.boundingBox())!
      expect(Math.abs(surface.x - cardBox.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(surface.width - cardBox.width)).toBeLessThanOrEqual(1)
      await context.close()
    })
  }
})

test.describe('Yesterday note height budget', () => {
  const viewports = [
    { name: 'desktop 1440x900', size: { width: 1440, height: 900 }, cap: 160 },
    { name: 'mobile 390x844', size: { width: 390, height: 844 }, cap: 180 },
  ]

  for (const vp of viewports) {
    test(`first today card moves down by at most ${vp.cap}px (${vp.name}), same for 4 and 10 tasks`, async ({ browser }) => {
      // Five sequential browser contexts: ~18 s alone, over the 30 s default under the full parallel suite (#169)
      test.slow()
      const offsets: Record<number, number> = {}
      let baseline = 0
      for (const count of [0, 1, 3, 4, 10]) {
        const context = await browser.newContext({ viewport: vp.size, locale: 'de-DE' })
        await seedLocalBoard(context, board(count))
        const page = await context.newPage()
        await page.goto('/tasks')
        if (vp.size.width < 768) await showColumnPage(page, 2)
        const card = page.locator('#column-done [data-task-id="done-today-1"]').first()
        await expect(card).toBeVisible()
        await page.waitForTimeout(400)
        const top = (await card.boundingBox())!.y
        if (count === 0) baseline = top
        else offsets[count] = top - baseline
        await context.close()
      }
      console.log(`[height] ${vp.name}`, JSON.stringify(offsets))
      for (const count of [1, 3, 4, 10]) expect(offsets[count]).toBeLessThanOrEqual(vp.cap)
      expect(offsets[4]).toBe(offsets[10])
    })
  }

  test('"Gesehen" is at least 44px tall at 390px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' })
    await seedLocalBoard(context, board(2))
    const page = await context.newPage()
    await page.goto('/tasks')
    await showColumnPage(page, 2)
    const box = await note(page).getByRole('button', { name: /^Gesehen/ }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await context.close()
  })

  test('reduced motion: the note leaves instantly', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-DE', reducedMotion: 'reduce' })
    await seedLocalBoard(context, board(2))
    const page = await context.newPage()
    await page.goto('/tasks')
    await note(page).getByRole('button', { name: /^Gesehen/ }).click()
    await expect(note(page)).toHaveCount(0, { timeout: 100 })
    await context.close()
  })
})
