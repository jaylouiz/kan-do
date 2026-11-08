/**
 * E2E: other task cards fade while the task sheet is open (issue #96).
 * Desktop slideover and mobile drawer, all columns, close paths, deep link, add route (draft card, #110).
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

const OPEN_ID = 'seed-open-1'
const OTHER_IDS = ['seed-open-2', 'seed-progress-1', 'seed-waiting-1', 'seed-done-1']
const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`).first()
const opacity = (page: Page, id: string) =>
  card(page, id).evaluate(el => Number(getComputedStyle(el).opacity))

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('fades other cards while the sheet is open and restores on close', async ({ page }) => {
      await page.goto('/tasks')
      await expect(card(page, OPEN_ID)).toBeAttached()
      for (const id of OTHER_IDS) expect(await opacity(page, id)).toBe(1)

      await page.evaluate((id) => document.querySelector<HTMLElement>(`.task[data-task-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), OPEN_ID)
      await expect(page.getByRole('dialog')).toBeVisible()
      for (const id of OTHER_IDS) await expect.poll(() => opacity(page, id)).toBeLessThan(0.6)
      expect(await opacity(page, OPEN_ID)).toBe(1)

      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/tasks$/)
      for (const id of [...OTHER_IDS, OPEN_ID]) await expect.poll(() => opacity(page, id)).toBe(1)
    })

    test('deep link shows the faded state and unknown id fades nothing', async ({ page }) => {
      await page.goto(`/tasks/${OPEN_ID}`)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect.poll(() => opacity(page, 'seed-open-2')).toBeLessThan(0.6)
      expect(await opacity(page, OPEN_ID)).toBe(1)

      await page.goto('/tasks/does-not-exist')
      await expect(card(page, 'seed-open-2')).toBeAttached()
      expect(await opacity(page, 'seed-open-2')).toBe(1)
    })

    test('add route fades the other cards and spotlights the draft card (#110)', async ({ page }) => {
      await page.goto('/tasks/add')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect.poll(() => opacity(page, 'seed-open-2')).toBeLessThan(0.6)
      const draft = page.getByTestId('task-draft-card').locator('.task')
      expect(await draft.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1)
    })

    test('browser back restores the cards', async ({ page }) => {
      await page.goto('/tasks')
      await page.evaluate(() => { history.pushState({}, '', '/tasks') })
      await page.goto(`/tasks/${OPEN_ID}`)
      await expect.poll(() => opacity(page, 'seed-open-2')).toBeLessThan(0.6)
      await page.goBack()
      await expect.poll(() => opacity(page, 'seed-open-2')).toBe(1)
    })
  })
}

test('reduced motion: fade is instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/tasks/${OPEN_ID}`)
  const duration = await card(page, 'seed-open-2').evaluate(el => getComputedStyle(el).transitionDuration)
  expect(duration.split(',').every(d => parseFloat(d) === 0)).toBe(true)
})

// A collapsed stack fades as one unit (#160): the wrapper takes the 0.55, the cards inside stay
// opaque so no peek card shows through the front card.
const STACK_TASKS = [
  ...[1, 2, 3].map(n => ({ id: `st-b${n}`, title: `Schnittstelle ${n}`, topic: 'Backend' })),
  ...[1, 2].map(n => ({ id: `st-d${n}`, title: `Konzept ${n}`, topic: 'Design' })),
  { id: 'st-single', title: 'Einzelne Aufgabe', topic: 'Solo' },
].map(t => ({
  ...t, status: 0, priority: 1, activity: null, topicColorCode: null, timeSpentSeconds: 0,
  timeBoxSeconds: null, custom: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}))

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 1200 }]) {
  test.describe(`stacks, ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context, STACK_TASKS, {}, { enabled: true, key: 'topic' })
    })

    const stackOpacities = (page: Page, key: string) =>
      page.locator(`.task-stack[data-stack-key="${key}"]`).evaluate(el => ({
        wrapper: Number(getComputedStyle(el).opacity),
        cards: [...el.querySelectorAll<HTMLElement>('.task:not(.stacked-task--hidden)')]
          .map(c => Number(getComputedStyle(c).opacity)),
      }))

    test('collapsed stacks fade as one unit, cards stay opaque', async ({ page }) => {
      await page.goto('/tasks/st-single')
      await expect(page.getByRole('dialog')).toBeVisible()
      for (const key of ['Backend', 'Design']) {
        await expect.poll(async () => (await stackOpacities(page, key)).wrapper).toBe(0.55)
        const { cards } = await stackOpacities(page, key)
        expect(cards.length).toBeGreaterThan(1)
        expect(cards.every(o => o === 1)).toBe(true)
      }
      await expect.poll(() => opacity(page, 'st-single')).toBe(1)
    })

    test('no stack fade without a sheet', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.locator('.task-stack[data-stack-key="Backend"]')).toBeVisible()
      expect((await stackOpacities(page, 'Backend')).wrapper).toBe(1)
    })

    test('a stack holding the open task is not faded', async ({ page }) => {
      await page.goto('/tasks/st-b1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-sheet-active]')).toHaveCount(1)
      await expect.poll(async () => (await stackOpacities(page, 'Backend')).wrapper).toBe(1)
    })
  })
}

test('reduced motion: stack fade is instant', async ({ page, context }) => {
  await seedLocalBoard(context, STACK_TASKS, {}, { enabled: true, key: 'topic' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tasks/st-single')
  const duration = await page.locator('.task-stack[data-stack-key="Backend"]')
    .evaluate(el => getComputedStyle(el).transitionDuration)
  expect(duration.split(',').every(d => parseFloat(d) === 0)).toBe(true)
})
