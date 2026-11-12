import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, dropSettled, showColumnPage } from './helpers/dnd'
import { dwell, flushFrames, focusUntilActive, settleAnimations, settleStack } from './helpers/settle'

/**
 * One open gesture for every pointer (kd#25): a click opens the task sheet on desktop too, a double-click opens it once,
 * a drag release and a click on a collapsed stack open nothing, Enter still opens. The hover lift shows on a pointer
 * that can hover and not on touch. Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
 */

const NOW = new Date().toISOString()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  topic: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

const PLAIN = [
  task({ id: 'p1', title: 'Erste Aufgabe', status: 0 }),
  task({ id: 'p2', title: 'Zweite Aufgabe', status: 0 }),
  task({ id: 'p3', title: 'Dritte Aufgabe', status: 0 }),
  task({ id: 'j1', title: 'Jetzt Aufgabe', status: 1 }),
]
const STACKED = [
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
]

const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const face = (page: Page, id: string) => card(page, id).locator('.task')
const stack = (page: Page) => page.locator('#column-open-list .task-stack')
const members = (page: Page) => page.locator('#column-open-list .task-wrapper[data-from-stack="Design"]')
const noSheet = (page: Page) => expect(page).not.toHaveURL(/\/tasks\/[^/]+/)

/** Counts the clicks that reach a card (not the body: dnd-kit swallows those) while `run` executes. */
async function cardClicksDuring(page: Page, run: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __cardClicks: number }
    w.__cardClicks = 0
    document.addEventListener('click', (e) => { if ((e.target as Element | null)?.closest?.('.task')) w.__cardClicks++ }, true)
  })
  await run()
  await flushFrames(page)
  return page.evaluate(() => (window as unknown as { __cardClicks: number }).__cardClicks)
}

test.describe('Card click opens (kd#25): plain cards', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, PLAIN)
    await page.goto('/tasks')
    await expect(face(page, 'p1')).toBeVisible()
  })

  test('a single click opens the sheet', async ({ page }) => {
    await face(page, 'p1').click()
    await page.waitForURL(/\/tasks\/p1/)
  })

  test('a double-click opens the sheet once', async ({ page }) => {
    const before = await page.evaluate(() => history.length)
    await face(page, 'p2').dblclick()
    await page.waitForURL(/\/tasks\/p2/)
    await settleAnimations(page)
    expect(await page.evaluate(() => history.length)).toBe(before + 1)
  })

  // page.dblclick() fires both clicks before the sheet's overlay mounts; a person's second click comes 80-400 ms later and
  // lands on that overlay, which must not dismiss the sheet (review of kd#36)
  for (const gap of [80, 150, 250, 400]) {
    test(`a double-click with a ${gap} ms gap leaves the sheet open`, async ({ page }) => {
      const box = (await face(page, 'p2').boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.click(x, y)
      await page.waitForTimeout(gap)
      await page.mouse.click(x, y)
      await page.waitForURL(/\/tasks\/p2/)
      await settleAnimations(page)
      await dwell(page, 700) // a dismiss goes through the leave animation and a history step
      await expect(page).toHaveURL(/\/tasks\/p2/)
      await expect(page.getByRole('dialog')).toBeVisible()
    })
  }

  // macOS Ctrl+click is the context menu's gesture (spec implementation note): it must not also open the sheet
  for (const modifier of ['Control', 'Meta', 'Shift'] as const) {
    test(`a ${modifier}+click does not open the sheet`, async ({ page }) => {
      await face(page, 'p2').click({ modifiers: [modifier] })
      await flushFrames(page)
      await dwell(page, 300)
      await noSheet(page)
    })
  }

  test('Ctrl+click opens the context menu and no sheet', async ({ page }) => {
    await face(page, 'p2').dispatchEvent('contextmenu', { ctrlKey: true, button: 0 })
    await expect(page.getByRole('menu')).toBeVisible()
    await noSheet(page)
  })

  test('a click on the overlay later still closes the sheet', async ({ page }) => {
    await face(page, 'p2').click()
    await page.waitForURL(/\/tasks\/p2/)
    await settleAnimations(page)
    await dwell(page, 700)
    await page.mouse.click(40, 600)
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('Enter on a focused card still opens the sheet', async ({ page }) => {
    await focusUntilActive(card(page, 'p1'))
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/tasks\/p1/)
  })

  test('a drag released in the same column opens nothing', async ({ page }) => {
    const clicks = await cardClicksDuring(page, async () => {
      await pickUp(page, face(page, 'p1'))
      await hover(page, face(page, 'p3'))
      await page.mouse.up()
      await dropSettled(page)
    })
    expect(clicks).toBe(0)
    await noSheet(page)
  })

  test('a drag released in another column opens nothing', async ({ page }) => {
    const clicks = await cardClicksDuring(page, async () => {
      await pickUp(page, face(page, 'p2'))
      await hover(page, page.locator('#column-waiting-list'))
      await page.mouse.up()
      await dropSettled(page)
    })
    expect(clicks).toBe(0)
    await noSheet(page)
    await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="p2"]')).toHaveCount(1)
  })

  test('a drag canceled with Escape opens nothing', async ({ page }) => {
    const clicks = await cardClicksDuring(page, async () => {
      await pickUp(page, face(page, 'p3'))
      await hover(page, face(page, 'p1'))
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await dropSettled(page)
    })
    expect(clicks).toBe(0)
    await noSheet(page)
  })

  test('a press that moves less than the drag distance is a click and opens', async ({ page }) => {
    const box = (await face(page, 'p2').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1)
    await page.mouse.up()
    await page.waitForURL(/\/tasks\/p2/)
  })

  test('the card lifts to the hovered shadow under a pointer that hovers', async ({ page }) => {
    const shadow = (id: string) => face(page, id).evaluate(el => getComputedStyle(el).boxShadow)
    const hoverToken = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.boxShadow = 'var(--shadow-task-hover)'
      document.body.append(probe)
      const value = getComputedStyle(probe).boxShadow
      probe.remove()
      return value
    })
    const rest = await shadow('p2')
    expect(rest).not.toBe(hoverToken)
    await face(page, 'p2').hover()
    await expect.poll(() => shadow('p2')).toBe(hoverToken)
    expect(await shadow('p1')).toBe(rest)
  })
})

test.describe('Card click opens (kd#25): stacks', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, STACKED, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  test('a click on a collapsed stack expands it and opens no sheet', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleStack(page)
    await noSheet(page)
  })

  test('a double-click on a collapsed stack expands it and opens no sheet', async ({ page }) => {
    await stack(page).dblclick()
    await expect(members(page)).toHaveCount(3)
    await settleStack(page)
    await noSheet(page)
  })

  test('a click on a member of an expanded stack opens its sheet', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleStack(page)
    await face(page, 'a2').click()
    await page.waitForURL(/\/tasks\/a2/)
  })

  test('a collapsed stack dragged and released opens nothing and does not expand', async ({ page }) => {
    const clicks = await cardClicksDuring(page, async () => {
      await pickUp(page, stack(page))
      await hover(page, face(page, 'u1'))
      await page.mouse.up()
      await dropSettled(page)
    })
    expect(clicks).toBe(0)
    await noSheet(page)
    await expect(members(page)).toHaveCount(0)
  })
})

test.describe('Card click opens (kd#25): touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a tap opens the sheet and the card has no hover lift', async ({ context, page }) => {
    await seedLocalBoard(context, PLAIN)
    await page.goto('/tasks')
    await showColumnPage(page, 0) // the board opens on Jetzt while a task sits there (kd#191)
    await expect(face(page, 'p1')).toBeVisible()
    const noHover = await page.evaluate(() => matchMedia('(hover: hover)').matches === false)
    expect(noHover).toBe(true)
    const shadow = () => face(page, 'p1').evaluate(el => getComputedStyle(el).boxShadow)
    const rest = await shadow()
    // Emulated hover on a device without hover: the lift stays out
    await face(page, 'p1').hover()
    await flushFrames(page)
    expect(await shadow()).toBe(rest)
    await face(page, 'p1').tap()
    await page.waitForURL(/\/tasks\/p1/)
  })
})
