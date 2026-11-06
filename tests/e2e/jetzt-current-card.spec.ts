/**
 * E2E: the card in Jetzt is a regular card again (#394, which replaced the large "current" variant of #93).
 * Same size, radius, title and ring as every other card; no grow animation and no pulsing halo. `data-current`
 * stays (the focus overlay measures it); the lamp itself is covered by focus-overlay.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { hover, pickUp } from './helpers/dnd'

const CURRENT = '.task[data-current][data-task-id="seed-progress-1"]'
const OTHERS = ['seed-open-1', 'seed-waiting-1', 'seed-done-1']

const style = (page: Page, selector: string, props: string[]) =>
  page.locator(selector).first().evaluate(
    (el, p) => Object.fromEntries(p.map(k => [k, getComputedStyle(el).getPropertyValue(k)])),
    props,
  )
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

test('the Jetzt card has the shape of every other card, running or not', async ({ page }) => {
  await page.goto('/tasks')
  const card = page.locator(CURRENT)
  await expect(card).toBeVisible()
  await expect(card).not.toHaveClass(/task-current/)
  const regular = '.task[data-task-id="seed-open-1"]'
  const title = await style(page, `${CURRENT} .task-title-text`, ['font-family', 'font-weight', 'font-size'])
  const regularTitle = await style(page, `${regular} .task-title-text`, ['font-family', 'font-weight', 'font-size'])
  expect(title).toEqual(regularTitle)
  expect(title['font-size']).not.toBe('24px')
  const [current, other] = [await box(page, CURRENT), await box(page, regular)]
  expect(Math.round(current.height)).toBe(Math.round(other.height))
  expect(Math.round(current.width)).toBe(Math.round(other.width))
  await expect(card).toHaveCSS('border-radius', '16px')
  expect(await card.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(await card.evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('none')
  expect(Math.round(current.height)).toBe(132)
})

test('other columns keep the standard look', async ({ page }) => {
  await page.goto('/tasks')
  for (const id of OTHERS) {
    const sel = `.task[data-task-id="${id}"]`
    await expect(page.locator(sel).first()).not.toHaveAttribute('data-current', '')
    const s = await style(page, sel, ['opacity', 'font-family'])
    expect(s.opacity).toBe('1')
    expect(s['font-family']).toContain('Figtree')
    const title = await style(page, `${sel} .task-title-text`, ['font-weight', 'font-size'])
    expect(title['font-weight']).toBe('400')
    expect(title['font-size']).not.toBe('24px')
    expect(Math.round((await box(page, sel)).height)).toBe(132)
  }
})

test('drag from Jetzt: overlay and placeholder are regular cards, also after crossing into another column', async ({ page }) => {
  await page.goto('/tasks')
  await pickUp(page, page.locator('#column-progress-list .task-wrapper').first())
  const preview = page.locator('.kando-dnd-preview')
  await expect(preview).not.toHaveClass(/task-current/)
  expect(await page.locator('.board').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s')
  const regular = await box(page, '.task[data-task-id="seed-open-1"]')
  const placeholder = (await page.locator('.kando-dnd-dragged .task').first().boundingBox())!
  expect(Math.round(placeholder.height)).toBe(Math.round(regular.height))
  expect(Math.round(placeholder.width)).toBe(Math.round(regular.width))

  await hover(page, page.locator('#column-done-list'))
  const inDone = page.locator('#column-done-list .kando-dnd-dragged .task')
  await expect(inDone).toHaveCount(1)
  const crossed = (await inDone.boundingBox())!
  const done = await box(page, '.task[data-task-id="seed-done-1"]')
  expect(Math.round(crossed.height)).toBe(Math.round(done.height))
  expect(Math.round(crossed.width)).toBe(Math.round(done.width))
  await page.mouse.up()
})

test('Wartet below does not jump when the card leaves Jetzt and comes back (A -> B -> A)', async ({ page }) => {
  await page.goto('/tasks')
  const waiting = page.locator('#column-waiting')
  const y0 = (await waiting.boundingBox())!.y

  await pickUp(page, page.locator('#column-progress-list .task-wrapper').first())
  await hover(page, page.locator('#column-done-list'))
  await page.mouse.up()
  await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(0)
  await expect(page.locator('.board.dragging')).toHaveCount(0)
  expect((await waiting.boundingBox())!.y).toBe(y0)

  await expect(page.locator('.kando-dnd-preview')).toHaveCount(0)
  await pickUp(page, page.locator('#column-open-list .task-wrapper').first())
  await hover(page, page.locator('#column-progress-list'))
  await page.mouse.up()
  await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
  await expect.poll(async () => (await waiting.boundingBox())!.y).toBe(y0)
})
