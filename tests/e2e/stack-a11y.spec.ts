import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleAnimations, settleStack } from './helpers/settle'
import { callTasksStore, fullTask } from './helpers/store'

/**
 * Task stacks (#147, #148): the visible front card is the stack's first task, and a collapsed stack is
 * one keyboard stop (button, named, aria-expanded) that Enter/Space open and Esc closes again.
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

const OPEN = [
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
  task({ id: 'b1', title: 'API prüfen', status: 0, topic: 'Backend' }),
]

const stack = (page: Page) => page.locator('#column-open-list .task-stack')
const control = (page: Page) => stack(page).locator('.task-stack__control')

test.beforeEach(async ({ context, page }) => {
  await seedLocalBoard(context, OPEN, {}, { enabled: true, key: 'topic' })
  await page.goto('/tasks')
  await expect(stack(page)).toBeVisible()
})

test('the visible front card of a collapsed stack is its first task', async ({ page }) => {
  const box = (await stack(page).boundingBox())!
  // The control covers the stack and the cards are inert (hit testing skips them): lift both for the
  // probe, which checks the z-order of the cards
  const hit = await page.evaluate(
    ([x, y]) => {
      const cards = [...document.querySelectorAll<HTMLElement>('#column-open-list .task-stack .task')]
      const ctrl = document.querySelector<HTMLElement>('#column-open-list .task-stack__control')!
      cards.forEach(card => card.removeAttribute('inert'))
      ctrl.style.pointerEvents = 'none'
      const id = document.elementFromPoint(x!, y!)?.closest('.task')?.getAttribute('data-task-id')
      ctrl.style.pointerEvents = ''
      cards.forEach(card => card.setAttribute('inert', ''))
      return id
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(hit).toBe('a1')
})

test('a collapsed stack is one named button; its cards are out of the tab order', async ({ page }) => {
  await expect(control(page)).toHaveAttribute('role', 'button')
  // label in name (WCAG 2.5.3, #154): the front card's visible title and the caption text
  await expect(control(page)).toHaveAttribute('aria-label', 'Konzept ausarbeiten, Design, 3 Aufgaben')
  await expect(control(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Konzept ausarbeiten, Design, 3 Aufgaben' })).toHaveCount(1)
  // a voice-control user can say the visible title or the group
  await expect(page.getByRole('button', { name: 'Konzept ausarbeiten' })).toHaveCount(1)
  await expect(stack(page).locator('.task[inert]')).toHaveCount(3)

  // Tab from the card before it reaches the stack, not one of its hidden cards
  await page.locator('.task-wrapper[data-task-id="u1"]').focus()
  await page.keyboard.press('Tab')
  await expect(control(page)).toBeFocused()
})

test('a collapsed stack shows its count as a pill on the front card (#195)', async ({ page }) => {
  const pill = stack(page).locator('.task-stack__pill-layer .task-stack__caption')
  await expect(pill).toHaveText('Design3')
  await expect(stack(page).locator('.task-stack__pill-layer')).toHaveAttribute('aria-hidden', 'true')
  await expect(stack(page).locator('.task-stack__pill-layer')).toHaveCSS('pointer-events', 'none')
  const front = (await stack(page).locator('.stacked-task--top').boundingBox())!
  const pillBox = (await pill.boundingBox())!
  expect(pillBox.y).toBeGreaterThanOrEqual(front.y)
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(front.y + front.height)
  // no rotation on any size: the front card is axis-aligned
  await expect(stack(page).locator('.stacked-task--top')).toHaveCSS('transform', 'none')
})

const member = (page: Page, id: string) => page.locator(`#column-open-list .task-wrapper[data-from-stack="Design"][data-task-id="${id}"]`)
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

test('Enter opens the stack, focus enters its first member, Tab walks the members, Esc closes and returns focus', async ({ page }) => {
  await control(page).focus()
  await page.keyboard.press('Enter')
  await expect(stack(page)).toHaveCount(0)
  await expect(status(page, 'Stapel Design geöffnet, 3 Aufgaben. Esc schließt.')).toBeAttached()

  // The members are ordinary cards: focusable one by one, in group order
  await expect(member(page, 'a1')).toBeFocused()
  // Each member says where it is in the group; the accessible name stays the task title (#154)
  await expect(member(page, 'a1')).toHaveAttribute('aria-label', 'Konzept ausarbeiten')
  const describedBy = await member(page, 'a1').getAttribute('aria-describedby')
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('1 von 3 in Design')
  await page.keyboard.press('Tab')
  await expect(member(page, 'a2')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(member(page, 'a3')).toBeFocused()
  await expect(page.locator(`[id="${await member(page, 'a3').getAttribute('aria-describedby')}"]`)).toHaveText('3 von 3 in Design')

  await page.keyboard.press('Escape')
  await expect(control(page)).toBeFocused()
  await expect(control(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(status(page, 'Stapel Design geschlossen.')).toBeAttached()
})

test('Space picks the whole stack up instead of opening it (#150); Esc puts it back', async ({ page }) => {
  await control(page).focus()
  await page.keyboard.press('Space')
  await expect(stack(page).first()).toHaveClass(/kando-dnd-dragged/)
  await expect(page.locator('body > [aria-live]')).toContainText('Stapel „Konzept ausarbeiten, Design, 3 Aufgaben“ in Spalte Offen, Position 2 aufgenommen. Er wird mit allen Aufgaben verschoben.')
  await page.keyboard.press('Escape')
  await expect(stack(page)).toHaveCount(1)
  await expect(stack(page)).not.toHaveClass(/kando-dnd-dragged/)
  await expect(page.locator('#column-open-list [data-from-stack]')).toHaveCount(0)
})

test('a held Enter opens the stack once and no task sheet (#156)', async ({ page }) => {
  // Enter on a member opens the sheet through a synthetic click (detail 0), dispatched synchronously in the
  // keydown. Counting it catches a missing repeat guard even before the sheet's route resolves.
  await page.evaluate(() => {
    (window as unknown as { openClicks: number }).openClicks = 0
    // The keyboard's open click has no pointer behind it (detail 0) and does not bubble: count it in the capture phase
    document.addEventListener('click', (event) => { if (event.detail === 0) (window as unknown as { openClicks: number }).openClicks++ }, true)
  })
  await control(page).focus()
  // A second keyboard.down of a key that is already down is an auto-repeat (event.repeat)
  await page.keyboard.down('Enter')
  // The repeats must land on the first member (where the guard under test is), not on the stack
  // control that is still focused while Vue re-renders
  await expect(member(page, 'a1')).toBeFocused()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  // The repeats are dropped by event.repeat and the post-expand guard is event-scoped (#154), so
  // nothing is waited out. Settle instead of sleeping: two frames let the key events and any navigation they caused run,
  // then every finite animation (the sheet's open transition) has finished
  await settleAnimations(page)
  expect(await page.evaluate(() => (window as unknown as { openClicks: number }).openClicks)).toBe(0)
  await expect(page).not.toHaveURL(/\/tasks\/a1/)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)
})

test('the stack control is a draggable button with stack-specific role description and instructions', async ({ page }) => {
  await expect(control(page)).toHaveAttribute('aria-roledescription', 'Verschiebbarer Stapel')
  const describedBy = await control(page).getAttribute('aria-describedby')
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/Enter öffnet den Stapel\. Leertaste hebt den ganzen Stapel auf/)
})

test('Esc stays with a keyboard drag and with the sheet; the stack stays open', async ({ page }) => {
  await control(page).focus()
  await page.keyboard.press('Enter')
  await expect(member(page, 'a2')).toBeVisible()
  await settleStack(page)

  // A keyboard drag: Space picks the member up, Esc cancels the drag, not the expansion
  await member(page, 'a2').focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await settleAnimations(page)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)
  await expect(control(page)).toHaveCount(0)

  // The Escape that ended the drag is spent; the very next one collapses, no waiting (#154)
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(stack(page)).toHaveCount(1)
  await expect(control(page)).toBeFocused()
  await control(page).press('Enter')
  await expect(member(page, 'a1')).toBeFocused()
  await settleStack(page)

  // The sheet: Esc closes it, the stack behind it stays open
  await member(page, 'a2').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tasks\/a2/)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/\/tasks\/a2/)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)
})

test('a pointer expand announces the hint for pointer and touch, not Esc (#154)', async ({ page }) => {
  await stack(page).click()
  await expect(status(page, 'Stapel Design geöffnet, 3 Aufgaben. Mit „Schließen“ einklappen.')).toBeAttached()
})

test('a keyboard expand never arms the sheet guard: Enter on a member opens it at once (#154)', async ({ page }) => {
  await control(page).focus()
  await page.keyboard.press('Enter')
  await expect(member(page, 'a1')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tasks\/a1/)
})

test('an outside click closes the stack, a click inside it does not', async ({ page }) => {
  await stack(page).click()
  await expect(member(page, 'a1')).toBeVisible()
  await settleStack(page)

  // A click on a member opens its sheet (#25) and leaves the group expanded
  await member(page, 'a2').locator('.task').click()
  await page.waitForURL(/\/tasks\/a2/)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)

  await page.locator('#column-open-list .task-wrapper[data-task-id="u1"] .task').click()
  await expect(stack(page)).toHaveCount(1)
})

test('expansion survives a sync that adds a member', async ({ page }) => {
  await stack(page).click()
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)

  await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'a4', title: 'Neu im Stapel', status: 0, topic: 'Design' })] })

  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(4)
  await expect(stack(page)).toHaveCount(0)
})

const header = (page: Page) => page.locator('#column-open-list .task-stack-header')

test('an expanded group has a header row with the pill and a round close X, outside the sortables', async ({ page }) => {
  await stack(page).click()
  await expect(header(page)).toBeVisible()
  // a labelled group named like the old caption; the X is an action, not a disclosure (#154)
  await expect(header(page)).toHaveAttribute('role', 'group')
  await expect(header(page)).toHaveAttribute('aria-label', 'Design · 3 Aufgaben')
  await expect(header(page).getByRole('button', { name: /schließen/i })).not.toHaveAttribute('aria-expanded', /.*/)
  await expect(header(page).locator('.task-stack-pill')).toBeVisible()
  await expect(header(page).locator('.task-stack-caption')).toHaveCount(0)
  await expect(header(page).getByRole('button', { name: 'Gruppe Design schließen' })).toBeVisible()
  await expect(header(page).locator('[data-task-id]')).toHaveCount(0)
  await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(3)
  // the header is the list item right before the first member
  const order = await page
    .locator('#column-open-list > .task-wrapper, #column-open-list > .task-stack-header')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-stack-header') ?? el.getAttribute('data-task-id')))
  expect(order).toEqual(['u1', 'Design', 'a1', 'a2', 'a3', 'b1'])
})

test('the close X collapses the group with the mouse and leaves focus alone', async ({ page }) => {
  await stack(page).click()
  await expect(header(page)).toBeVisible()
  await settleStack(page)
  await header(page).getByRole('button', { name: /schließen/i }).click()
  await expect(stack(page)).toHaveCount(1)
  await expect(header(page)).toHaveCount(0)
  await expect(control(page)).not.toBeFocused()
  await expect(status(page, 'Stapel Design geschlossen.')).toBeAttached()
})

for (const key of ['Enter', 'Space']) {
  test(`${key} on the close X collapses the group and returns focus to the stack`, async ({ page }) => {
    await control(page).focus()
    await page.keyboard.press('Enter')
    await expect(member(page, 'a1')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(header(page).getByRole('button', { name: /schließen/i })).toBeFocused()
    await page.keyboard.press(key)
    await expect(stack(page)).toHaveCount(1)
    await expect(control(page)).toBeFocused()
  })
}

test('settleAnimations returns despite an infinite and a cancelled animation (#196)', async ({ page }) => {
  await page.evaluate(() => {
    document.body.animate([{ opacity: 1 }, { opacity: 0.99 }], { duration: 100, iterations: Infinity })
    document.body.animate([{ opacity: 1 }, { opacity: 0.98 }], { duration: 5000 }).cancel()
    document.body.animate([{ opacity: 1 }, { opacity: 0.97 }], { duration: 100 })
  })
  await settleAnimations(page)
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0)
})
