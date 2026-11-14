import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { finger, showColumnPage } from './helpers/dnd'
import { dwell, flushFrames } from './helpers/settle'

/**
 * The card menu button and the hold (#296): on a phone a soft round button in the card's top-right corner opens the
 * menu anchored at it, a press-and-hold only drags (never a menu), the button never starts a drag or opens the sheet,
 * a done card keeps its check beside it. On a mouse desktop there is no button and right-click opens the same menu,
 * whose highlighted row is no longer white.
 */

const OPEN = SEED_TASKS.find(t => t.status === 0)!
const DONE: SeedTask = { ...OPEN, id: 'done-1', title: 'Fertige Aufgabe', status: 3, completedAt: new Date().toISOString() }
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const menuButton = (page: Page, id: string) => card(page, id).getByTestId('task-menu-button')
const menu = (page: Page) => page.getByRole('menu')

test.describe('phone (390px, touch)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, [...SEED_TASKS, DONE])
    await page.goto('/tasks')
    await showColumnPage(page, 0) // the board opens on Jetzt while a task runs there
    await expect(card(page, OPEN.id)).toBeVisible()
  })

  test('every card has a named soft round button in its top-right corner', async ({ page }) => {
    const button = menuButton(page, OPEN.id)
    await expect(button).toBeVisible()
    await expect(button).toHaveAccessibleName('Aktionen für diese Aufgabe')
    const [b, c] = [(await button.boundingBox())!, (await card(page, OPEN.id).locator('.task').boundingBox())!]
    expect(Math.round(b.width)).toBe(28)
    expect(Math.round(b.height)).toBe(28)
    expect(c.x + c.width - (b.x + b.width)).toBeCloseTo(6, 0)
    expect(b.y - c.y).toBeCloseTo(6, 0)
    const radius = await button.evaluate(el => getComputedStyle(el).borderTopLeftRadius)
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(14)
    // titles and topics never run under it: 30 px room on the right
    const room = await card(page, OPEN.id).locator('.task-title-text').evaluate(el => parseFloat(getComputedStyle(el).paddingRight))
    expect(room).toBeGreaterThanOrEqual(30)
  })

  test('a tap opens the menu anchored at the button, fully visible, and opens no sheet', async ({ page }) => {
    await menuButton(page, OPEN.id).tap()
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Jetzt starten' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Titel kopieren' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Duplizieren' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: /In .* öffnen/ })).toHaveCount(0) // a Local task has no source page
    const m = (await menu(page).boundingBox())!
    const b = (await menuButton(page, OPEN.id).boundingBox())!
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(390)
    expect(m.y).toBeGreaterThanOrEqual(b.y + b.height - 1) // below the button, not behind the card
    expect(page.url()).not.toContain(`/tasks/${OPEN.id}`)
    await expect(page.locator('.board.dragging')).toHaveCount(0)
  })

  test('Mark done in the menu moves the card to Erledigt; the menu closes', async ({ page }) => {
    await menuButton(page, OPEN.id).tap()
    await menu(page).getByRole('menuitem', { name: 'Als erledigt markieren' }).tap()
    await expect(menu(page)).toHaveCount(0)
    await expect(page.locator('#column-done-list').locator(`.task-wrapper[data-task-id="${OPEN.id}"]`)).toHaveCount(1)
  })

  test('a press-and-hold on the card starts a drag and opens no menu', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page)
    const box = (await card(page, OPEN.id).locator('.task').boundingBox())!
    await touch.start(box.x + 40, box.y + box.height / 2)
    await dwell(page, 900) // past the old 750 ms hold: no menu
    await expect(menu(page)).toHaveCount(0)
    await touch.moveTo(box.x + 40, box.y + box.height / 2 + 24, 6, 20)
    await expect(page.locator('.board.dragging')).toHaveCount(1) // the hold belongs to the drag
    await expect(menu(page)).toHaveCount(0)
    await touch.end()
    await flushFrames(page)
    await expect(menu(page)).toHaveCount(0)
  })

  test('a press-and-move that starts on the button starts no drag', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page)
    const b = (await menuButton(page, OPEN.id).boundingBox())!
    await touch.start(b.x + b.width / 2, b.y + b.height / 2)
    await touch.moveTo(b.x + b.width / 2 - 60, b.y + 120, 12, 20)
    await expect(page.locator('.board.dragging')).toHaveCount(0)
    await touch.end()
  })

  test('a done card shows its check left of the button, no overlap', async ({ page }) => {
    await showColumnPage(page, 2)
    const wrapper = card(page, DONE.id)
    await wrapper.scrollIntoViewIfNeeded()
    const check = (await wrapper.locator('.task-done-check').boundingBox())!
    const button = (await menuButton(page, DONE.id).boundingBox())!
    expect(check.x + check.width).toBeLessThanOrEqual(button.x)
    const titleRoom = await wrapper.locator('.task-title-text').evaluate(el => parseFloat(getComputedStyle(el).paddingRight))
    expect(titleRoom).toBeGreaterThanOrEqual(68)
  })
})

test.describe('desktop (mouse)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(card(page, OPEN.id)).toBeVisible()
  })

  test('no button; right-click opens the menu whose highlighted row is the muted paper tone', async ({ page }) => {
    await expect(menuButton(page, OPEN.id)).toBeHidden()
    await card(page, OPEN.id).locator('.task').click({ button: 'right' })
    await expect(menu(page)).toBeVisible()
    const item = menu(page).getByRole('menuitem', { name: 'Titel kopieren' })
    await item.hover()
    await expect(item).toHaveAttribute('data-highlighted', '')
    await expect(item).toHaveCSS('cursor', 'pointer')
    const read = (value: string) => page.evaluate((v) => { const probe = document.createElement('i'); probe.style.background = v; document.body.append(probe); const out = getComputedStyle(probe).backgroundColor; probe.remove(); return out }, value)
    const [muted, elevated] = [await read('var(--ui-bg-muted)'), await read('var(--ui-bg-elevated)')]
    // the row's background is its ::before; it fades in (transition-colors), so read it settled
    await expect.poll(() => item.evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe(muted)
    expect(muted).not.toBe(elevated)
    const height = (await item.boundingBox())!.height
    expect(Math.round(height)).toBeGreaterThanOrEqual(40)
  })

  test('no menu row carries an icon', async ({ page }) => {
    await card(page, OPEN.id).locator('.task').click({ button: 'right' })
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).locator('[data-slot="itemLeadingIcon"]')).toHaveCount(0)
  })
})
