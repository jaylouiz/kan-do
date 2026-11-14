import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, edgeDwell } from './helpers/dnd'

/**
 * Dropping a card into Erledigt (#124): a light teal wash under the list and a one-line hint
 * while a card from another column hovers it; the card lands at the index the landing slot
 * (dnd-kit's `.kando-dnd-dragged` placeholder) showed and plays a short in-card confirmation.
 * No toast on this path (#136): the card and the drop announcement confirm it, undo is the
 * reverse drag. Completion burst (#692): the earned celebration around the card, once per completion. Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
 */

const NOW = new Date().toISOString()
/** Noon yesterday: the task shows in the Gestern note, not in the Erledigt list */
const YESTERDAY = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
})()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

const OPEN = task({ id: 'open-1', title: 'Konzept ausarbeiten', status: 0, timeBoxSeconds: 2700 })
const DONE = [
  task({ id: 'done-1', title: 'Retrospektive nachbereiten', status: 3, completedAt: NOW, timeBoxSeconds: 3600, timeSpentSeconds: 3600 }),
  task({ id: 'done-2', title: 'Angebot schicken', status: 3, completedAt: NOW }),
  task({ id: 'done-3', title: 'Release-Notizen schreiben', status: 3, completedAt: NOW }),
]

/** Done yesterday, seeded first so it leads the full done order (it is not rendered in the list) */
const DONE_YESTERDAY = task({ id: 'done-y', title: 'Rechnung ablegen', status: 3, completedAt: YESTERDAY })

const doneColumn = (page: Page) => page.locator('#column-done')
const doneList = (page: Page) => page.locator('#column-done-list')
const doneWrappers = (page: Page) => doneList(page).locator(':scope > .task-wrapper')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const toasts = (page: Page) => page.locator('[data-slot="viewport"] [data-slot="root"]')

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, OPEN.id)).toBeVisible()
}

/** Hovers the top edge of a card in Erledigt so the landing slot opens before it. */
const hoverBefore = (page: Page, target: Locator) => hover(page, target, { fromTop: 10 })

/** Index of the landing slot among the Erledigt list items while the drag is held. */
async function placeholderIndex(page: Page) {
  return doneWrappers(page).evaluateAll((els) => els.findIndex((el) => el.classList.contains('kando-dnd-dragged')))
}

const doneOrder = (page: Page) =>
  doneWrappers(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id')))

const backgroundOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)

test.describe('Drop into Erledigt (#124)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [OPEN, ...DONE])
  })

  test('the card lands at the landing-slot index, with wash and a short in-card confirmation', async ({ page }) => {
    await gotoBoard(page)
    const restingBackground = await backgroundOf(doneColumn(page))
    const regularHeight = (await card(page, 'done-1').boundingBox())!.height

    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))

    // Wash + hint while hovering; the list stays visible
    await expect(doneColumn(page)).toHaveClass(/is-done-drop-target/)
    await expect(doneColumn(page).getByText('Hier ablegen, um die Aufgabe als erledigt zu markieren')).toBeVisible()
    await expect.poll(() => backgroundOf(doneColumn(page))).not.toBe(restingBackground)
    await expect(doneList(page)).not.toHaveAttribute('aria-hidden', 'true')

    // Landing slot: the placeholder moved into Erledigt at regular card size
    const slot = doneList(page).locator('.task-wrapper.kando-dnd-dragged')
    await expect(slot).toHaveCount(1)
    const slotHeight = (await slot.locator('.task').boundingBox())!.height
    expect(Math.abs(slotHeight - regularHeight)).toBeLessThanOrEqual(2)
    const indexAtRelease = await placeholderIndex(page)
    expect(indexAtRelease).toBe(1)

    await page.mouse.up()

    // Final index equals the slot's index at release
    await expect.poll(() =>
      doneWrappers(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id'))),
    ).toEqual(['done-1', OPEN.id, 'done-2', 'done-3'])

    // One in-card confirmation on the dropped card only, then gone
    const dropped = doneList(page).locator(`[data-task-id="${OPEN.id}"] .task`)
    await expect(dropped).toHaveClass(/task--confirming/)
    await expect(dropped.locator('.task-confirm')).toHaveAttribute('aria-hidden', 'true')
    await expect(doneList(page).locator('.task-confirm')).toHaveCount(1)
    await expect(dropped.locator('.task-confirm')).toHaveCount(0, { timeout: 2000 })
    await expect(dropped).toHaveClass(/task-done/)

    // The wash fades out; no praise copy and no toast (#136)
    await expect(doneColumn(page)).not.toHaveClass(/is-done-drop-target/)
    await expect.poll(() => backgroundOf(doneColumn(page))).toBe(restingBackground)
    await expect(page.getByText('Gut gemacht!')).toHaveCount(0)
    await expect(toasts(page)).toHaveCount(0)
  })

  test('the drop plays one decorative completion burst on the dropped card and takes no input (#692)', async ({ page }) => {
    await gotoBoard(page)
    const burstIn = (id: string) => doneList(page).locator(`[data-task-id="${id}"] [data-testid="completion-burst"]`)
    await expect(page.getByTestId('completion-burst')).toHaveCount(0) // nothing on load, not even for the done cards
    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()

    // One burst, on the dropped card only: decorative, 40 pieces, takes no pointer events
    await expect(page.getByTestId('completion-burst')).toHaveCount(1)
    await expect(burstIn(OPEN.id)).toHaveAttribute('aria-hidden', 'true')
    await expect(burstIn(OPEN.id).locator('i')).toHaveCount(40)
    await expect(burstIn(OPEN.id)).toHaveCSS('pointer-events', 'none')
    await expect(burstIn(OPEN.id).locator('i').first()).toHaveCSS('pointer-events', 'none')

    // The pieces fly over the card below, not under it: every card is its own stacking context, so the dropped card
    // sits one step above its neighbours while the burst plays
    const z = (id: string) => card(page, id).locator('.task').evaluate((el) => Number(getComputedStyle(el).zIndex))
    expect(await z(OPEN.id)).toBeGreaterThan(await z('done-2'))
    expect(await z(OPEN.id)).toBeGreaterThan(await z('done-1'))
    // Nothing takes focus
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="completion-burst"]'))).toBeNull()

    // Over within about 1.3 s, no text and no toast
    await expect(page.getByTestId('completion-burst')).toHaveCount(0, { timeout: 2000 })
    await expect(toasts(page)).toHaveCount(0)
  })

  test('at the narrowest desktop width the burst is clipped at the board edge: no horizontal scrollbar (#692)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await gotoBoard(page)
    const pageSize = () => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])
    const before = await pageSize()

    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()

    // Erledigt is the right-hand column: its card's pieces fly ~310 px past the screen edge
    await expect(page.getByTestId('completion-burst')).toHaveCount(1)
    // The width is the one from before the drop (only the x axis is clipped; the height settles with the landing card)
    expect((await pageSize())[0]).toBe(before[0])
    await expect(page.getByTestId('completion-burst')).toHaveCount(0, { timeout: 2000 })
  })

  test('a reload leaves cards in Erledigt without a burst (#692)', async ({ page }) => {
    await gotoBoard(page)
    await expect(doneWrappers(page)).toHaveCount(3)
    await page.reload()
    await expect(doneWrappers(page)).toHaveCount(3)
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId('completion-burst')).toHaveCount(0)
      await page.waitForTimeout(100)
    }
  })

  test('a drag inside Erledigt shows no wash and no confirmation', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, 'done-3'))
    await hoverBefore(page, card(page, 'done-1'))

    await expect(doneColumn(page)).not.toHaveClass(/is-done-drop-target/)
    await expect(doneColumn(page).getByText('Hier ablegen, um die Aufgabe als erledigt zu markieren')).toHaveCount(0)

    await page.mouse.up()
    await page.waitForTimeout(200)
    await expect(page.locator('.task-confirm')).toHaveCount(0)
  })

  test('the reverse drag is the undo: the card goes back to Offen without a layer', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()
    await expect.poll(() => doneOrder(page)).toEqual(['done-1', OPEN.id, 'done-2', 'done-3'])
    // The confirmation of the drop may still be playing: pickUp waits for it to end before it presses (#408)

    // Offen is empty now, so its drop zone takes the card
    await pickUp(page, card(page, OPEN.id))
    const zone = (await page.locator('#column-open-list .column-drop-zone').boundingBox())!
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 30 })
    await page.waitForTimeout(300)
    await page.mouse.up()

    await expect(page.locator(`#column-open-list .task-wrapper[data-task-id="${OPEN.id}"] .task`)).not.toHaveClass(/task-done/)
    await expect(doneList(page).locator(`[data-task-id="${OPEN.id}"]`)).toHaveCount(0)
    await expect(page.locator('.task-confirm')).toHaveCount(0)
    await expect(toasts(page)).toHaveCount(0)
  })

  test('reduced motion: no confirmation layer and no toast, the done state at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoBoard(page)
    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()

    const dropped = doneList(page).locator(`[data-task-id="${OPEN.id}"] .task`)
    await expect(dropped).toHaveClass(/task-done/)
    // The layer is hidden in CSS under reduced motion, never shown
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.task-confirm')).toBeHidden()
      await page.waitForTimeout(100)
    }
    // No burst either (#692): not mounted at all under reduced motion
    await expect(page.getByTestId('completion-burst')).toHaveCount(0)
    await expect(toasts(page)).toHaveCount(0)
  })

  test('keyboard drag into Erledigt plays the confirmation and announces the drop, without a toast', async ({ page }) => {
    await gotoBoard(page)
    const live = page.locator('body > [aria-live]')
    await card(page, OPEN.id).focus()
    await page.keyboard.press('Space')
    await expect(live).toContainText('aufgenommen')

    for (let i = 0; i < 4; i++) {
      if ((await live.textContent())?.includes('Spalte Erledigt')) break
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(250)
    }
    await expect(live).toContainText('Spalte Erledigt')
    await page.keyboard.press('Space')

    await expect(doneList(page).locator(`[data-task-id="${OPEN.id}"] .task-confirm`)).toHaveCount(1)
    // The drop announcement is the only words on the drag path (#136)
    await expect(live).toContainText('abgelegt')
    // The same burst as for a mouse drop (#692)
    await expect(doneList(page).locator(`[data-task-id="${OPEN.id}"] [data-testid="completion-burst"]`)).toHaveCount(1)
    await expect(page.locator('.task-confirm')).toHaveCount(0, { timeout: 2000 })
    await expect(page.getByTestId('completion-burst')).toHaveCount(0, { timeout: 2000 })
    await expect(toasts(page)).toHaveCount(0)
  })
})

test.describe('Faster than planned (#295)', () => {
  const RUNNING = task({ id: 'run-1', title: 'Angebot prüfen', status: 1, timeBoxSeconds: 2700, timeSpentSeconds: 1200 })
  const OVER = task({ id: 'over-1', title: 'Entwurf überarbeiten', status: 0, timeBoxSeconds: 600, timeSpentSeconds: 900 })
  const IDLE = task({ id: 'idle-1', title: 'Ablage sortieren', status: 0, timeBoxSeconds: 2700, timeSpentSeconds: 0 })
  const NO_BOX = task({ id: 'nobox-1', title: 'Mail beantworten', status: 0, timeSpentSeconds: 600 })

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [RUNNING, OVER, IDLE, NO_BOX, ...DONE])
  })

  const dropIntoDone = async (page: Page, id: string) => {
    await pickUp(page, card(page, id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()
  }
  const layerOf = (page: Page, id: string) => doneList(page).locator(`[data-task-id="${id}"] .task-confirm`)

  test('a card finished below its timebox shows the rocket and the sentence instead of the check, then fades out', async ({ page }) => {
    await page.goto('/tasks')
    await expect(card(page, RUNNING.id)).toBeVisible()
    await dropIntoDone(page, RUNNING.id)

    const layer = layerOf(page, RUNNING.id)
    await expect(layer).toHaveCount(1)
    await expect(layer).toHaveAttribute('aria-hidden', 'true')
    await expect(layer.getByText('Sehr gut! Schneller als geplant.')).toBeVisible()
    await expect(layer.locator('.task-confirm__rocket')).toBeVisible()
    await expect(layer.locator('.task-confirm__icon')).toHaveCount(0)
    // The burst plays with it
    await expect(page.getByTestId('completion-burst')).toHaveCount(1)

    // It holds longer than the plain check (1.3 s) and is gone by 2.2 s
    await page.waitForTimeout(1500)
    await expect(layer).toHaveCount(1)
    await expect(layer).toHaveCount(0, { timeout: 2000 })
    await expect(toasts(page)).toHaveCount(0)
  })

  for (const [label, id] of [['over the timebox', OVER.id], ['never run (0 s spent)', IDLE.id], ['without a timebox', NO_BOX.id]] as const) {
    test(`a card ${label} shows the plain bold check, never the sentence`, async ({ page }) => {
      await page.goto('/tasks')
      await expect(card(page, id)).toBeVisible()
      await dropIntoDone(page, id)

      const layer = layerOf(page, id)
      await expect(layer.locator('.task-confirm__icon')).toBeVisible()
      await expect(layer.locator('.task-confirm__message')).toHaveCount(0)
      await expect(page.getByText('Sehr gut! Schneller als geplant.')).toHaveCount(0)
      await expect(layer).toHaveCount(0, { timeout: 2500 })
    })
  }

  test('reduced motion shows no message and no burst either', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/tasks')
    await expect(card(page, RUNNING.id)).toBeVisible()
    await dropIntoDone(page, RUNNING.id)
    await expect(doneList(page).locator(`[data-task-id="${RUNNING.id}"] .task`)).toHaveClass(/task-done/)
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.task-confirm')).toBeHidden()
      await expect(page.getByText('Sehr gut! Schneller als geplant.')).toBeHidden()
      await page.waitForTimeout(100)
    }
    await expect(page.getByTestId('completion-burst')).toHaveCount(0)
  })
})

test.describe('Drop into Erledigt with a task done yesterday (#124)', () => {
  // Erledigt renders today's tasks; the full done order starts with the Gestern task, which the
  // slot index must not count
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [OPEN, DONE_YESTERDAY, ...DONE])
  })

  test('a card from Offen lands at the landing-slot index', async ({ page }) => {
    await gotoBoard(page)
    await page.getByTestId('yesterday-toggle').click() // the note lists its titles on demand (#605)
    await expect(page.getByText(DONE_YESTERDAY.title)).toBeVisible()
    await expect.poll(() => doneOrder(page)).toEqual(['done-1', 'done-2', 'done-3'])

    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    expect(await placeholderIndex(page)).toBe(1)
    await page.mouse.up()

    await expect.poll(() => doneOrder(page)).toEqual(['done-1', OPEN.id, 'done-2', 'done-3'])
    await expect(page.getByText(DONE_YESTERDAY.title)).toBeVisible()
  })

  test('a reorder inside Erledigt lands at the landing-slot index', async ({ page }) => {
    await gotoBoard(page)
    await page.getByTestId('yesterday-toggle').click()
    await expect(page.getByText(DONE_YESTERDAY.title)).toBeVisible()
    await pickUp(page, card(page, 'done-3'))
    await hoverBefore(page, card(page, 'done-1'))
    expect(await placeholderIndex(page)).toBe(0)
    await page.mouse.up()

    await expect.poll(() => doneOrder(page)).toEqual(['done-3', 'done-1', 'done-2'])
    await expect(page.getByText(DONE_YESTERDAY.title)).toBeVisible()
  })
})

test.describe('Drop into an empty Erledigt (#124)', () => {
  test('the drop-zone ghost is the landing slot at regular card size', async ({ context, page }) => {
    await seedLocalBoard(context, [OPEN, task({ id: 'open-2', title: 'Dokumentation lesen', status: 0 })])
    await gotoBoard(page)
    const regularHeight = (await card(page, 'open-2').boundingBox())!.height

    await pickUp(page, card(page, OPEN.id))
    const zone = (await doneColumn(page).locator('.column-drop-zone').boundingBox())!
    await page.mouse.move(zone.x + zone.width / 2, zone.y + 40, { steps: 30 })
    await page.waitForTimeout(400)

    await expect(doneColumn(page)).toHaveClass(/is-done-drop-target/)
    const ghost = doneColumn(page).locator('.column-drop-zone__ghost')
    await expect(ghost).toBeVisible()
    expect(Math.abs((await ghost.boundingBox())!.height - regularHeight)).toBeLessThanOrEqual(2)

    await page.mouse.up()
    await expect(doneList(page).locator(`[data-task-id="${OPEN.id}"] .task-confirm`)).toHaveCount(1)
  })
})

test.describe('Drop into Erledigt at 390px (#124)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('edge-dwell into Erledigt shows the wash and lands the card with the confirmation', async ({ context, page }) => {
    await seedLocalBoard(context, [OPEN, ...DONE])
    await gotoBoard(page)

    await pickUp(page, card(page, OPEN.id))
    // Dwell in the right edge zone twice: Offen -> Jetzt/Wartet -> Erledigt
    await edgeDwell(page, 'right')
    await edgeDwell(page, 'right')
    await hoverBefore(page, card(page, 'done-2'))

    await expect(doneColumn(page)).toHaveClass(/is-done-drop-target/)
    const indexAtRelease = await placeholderIndex(page)
    expect(indexAtRelease).toBeGreaterThanOrEqual(0)
    await page.mouse.up()

    await expect.poll(() =>
      doneWrappers(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id'))),
    ).toContain(OPEN.id)
    const ids = await doneWrappers(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id')))
    expect(ids.indexOf(OPEN.id)).toBe(indexAtRelease)
    await expect(doneList(page).locator(`[data-task-id="${OPEN.id}"] .task-confirm`)).toHaveCount(1)
  })
})

test.describe('A whole stack dropped into Erledigt (#150)', () => {
  // Replaces the skipped done-celebration spec: Offen holds the stack Design (s1 s2 s3)
  const STACK = ['s1', 's2', 's3'].map((id, i) =>
    task({ id, title: `Konzept ${i + 1}`, status: 0, topic: 'Design' }))
  const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }
  // The undo toast: found by its title and its one action (the Nuxt UI toast markup has no stable hook)
  const undoButtons = (page: Page) => page.getByRole('button', { name: 'Rückgängig' })
  const stackToast = (page: Page) =>
    page.getByText('3 Aufgaben erledigt', { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Rückgängig"]][1]')
  const stackIn = (page: Page, column: 'open' | 'waiting' | 'done') =>
    page.locator(`#column-${column}-list .task-stack[data-task-id="s1"]`)
  const storeTask = (page: Page, id: string) =>
    page.evaluate((taskId) => {
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, { task: (id: string) => { status: number; completedAt: string | null } }> } } }).useNuxtApp()
      const found = app.$pinia._s.get('tasks')!.task(taskId)
      return { status: found.status, completedAt: found.completedAt }
    }, id)

  async function gotoStackBoard(page: Page) {
    await page.goto('/tasks')
    await expect(stackIn(page, 'open')).toBeVisible()
  }

  test('completes every member, plays the confirmation, shows ONE toast; Undo restores all of them', async ({ context, page }) => {
    await seedLocalBoard(context, [...STACK, ...DONE], {}, GROUP_BY_TOPIC)
    await gotoStackBoard(page)

    await pickUp(page, stackIn(page, 'open'))
    await hoverBefore(page, card(page, 'done-2'))
    await expect(doneColumn(page)).toHaveClass(/is-done-drop-target/)
    // the landing slot is the stack's placeholder, in Erledigt
    await expect(doneList(page).locator('.task-stack.kando-dnd-dragged')).toHaveCount(1)
    await page.mouse.up()

    await expect(stackIn(page, 'done')).toHaveAttribute('data-stack-size', '3')
    await expect(stackIn(page, 'open')).toHaveCount(0)
    for (const id of ['s1', 's2', 's3']) {
      const stored = await storeTask(page, id)
      expect(stored.status).toBe(3)
      expect(stored.completedAt).not.toBeNull()
    }
    // the visible front card plays the layer
    await expect(stackIn(page, 'done').locator('.stacked-task--top .task-confirm')).toHaveCount(1)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)

    // ONE toast for the whole stack
    await expect(undoButtons(page)).toHaveCount(1)
    await expect(stackToast(page)).toBeVisible()
    await undoButtons(page).click()

    await expect(stackIn(page, 'open')).toHaveAttribute('data-stack-size', '3')
    await expect(stackIn(page, 'done')).toHaveCount(0)
    for (const id of ['s1', 's2', 's3']) {
      const stored = await storeTask(page, id)
      expect(stored.status).toBe(0)
      expect(stored.completedAt).toBeNull()
    }
    await expect(page.locator('.task-confirm')).toHaveCount(0)
  })

  test('dragging the stack out of Erledigt again clears completedAt per member and shows no toast', async ({ context, page }) => {
    await seedLocalBoard(
      context,
      [
        ...['s1', 's2', 's3'].map((id, i) => task({ id, title: `Konzept ${i + 1}`, status: 3, topic: 'Design', completedAt: NOW })),
        task({ id: 'w1', title: 'Blocker klären', status: 2, topic: 'Wartung' }),
      ],
      {},
      GROUP_BY_TOPIC,
    )
    await page.goto('/tasks')
    await expect(stackIn(page, 'done')).toBeVisible()

    await pickUp(page, stackIn(page, 'done'))
    await hoverBefore(page, card(page, 'w1'))
    await page.mouse.up()

    await expect(stackIn(page, 'waiting')).toHaveAttribute('data-stack-size', '3')
    for (const id of ['s1', 's2', 's3']) {
      const stored = await storeTask(page, id)
      expect(stored.status).toBe(2)
      expect(stored.completedAt).toBeNull()
    }
    await page.waitForTimeout(300)
    await expect(undoButtons(page)).toHaveCount(0)
  })

  test.describe('at 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('edge-dwell into Erledigt works; the shared Jetzt/Wartet tab refuses it for Jetzt', async ({ context, page }) => {
      await seedLocalBoard(context, [...STACK, ...DONE], {}, GROUP_BY_TOPIC)
      await gotoStackBoard(page)

      await pickUp(page, stackIn(page, 'open'))
      // First dwell: Offen -> Jetzt/Wartet. Jetzt is empty here but a stack never lands in it.
      await edgeDwell(page, 'right')
      await expect(page.locator('#column-progress-list .kando-dnd-dragged')).toHaveCount(0)
      await expect(page.locator('#column-progress .column-drop-zone__ghost')).toHaveCount(0)

      // Second dwell: -> Erledigt
      await edgeDwell(page, 'right')
      await hoverBefore(page, card(page, 'done-2'))
      await expect(doneColumn(page)).toHaveClass(/is-done-drop-target/)
      await page.mouse.up()

      await expect(stackIn(page, 'done')).toHaveAttribute('data-stack-size', '3')
      await expect(stackToast(page)).toBeVisible()
    })
  })
})

test.describe('Done check spring (#611)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [OPEN, ...DONE])
  })

  const checkOf = (page: Page, id: string) => card(page, id).locator('.task-done-check')
  const animationOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).animationName)

  test('a drop springs the check once; cards that were done on load, and open cards, show it static or not at all', async ({ page }) => {
    await gotoBoard(page)
    await expect(checkOf(page, 'done-1')).toBeVisible()
    await expect(checkOf(page, 'done-1')).not.toHaveClass(/task-done-check--pop/)
    await expect(card(page, OPEN.id).locator('.task-done-check')).toHaveCount(0)

    await pickUp(page, card(page, OPEN.id))
    await hoverBefore(page, card(page, 'done-2'))
    await page.mouse.up()

    const dropped = checkOf(page, OPEN.id)
    await expect(dropped).toHaveClass(/task-done-check--pop/)
    expect(await animationOf(dropped)).toMatch(/^done-check-pop/) // scoped CSS suffixes the keyframes name
    // Once played it rests as the static check, and the other done cards never moved
    await expect(dropped).not.toHaveClass(/task-done-check--pop/, { timeout: 3000 })
    await expect(dropped).toBeVisible()
    await expect(checkOf(page, 'done-2')).not.toHaveClass(/task-done-check--pop/)
  })

  test('a move from the command palette springs the check too, a reload shows none', async ({ page }) => {
    await gotoBoard(page)
    await card(page, OPEN.id).focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('erledigt')
    await page.keyboard.press('Enter')

    await expect(checkOf(page, OPEN.id)).toHaveClass(/task-done-check--pop/)
    await expect(checkOf(page, OPEN.id)).not.toHaveClass(/task-done-check--pop/, { timeout: 3000 })

    // A reload mounts every done card fresh and flags none (the seed puts the task back into Offen)
    await page.reload()
    await expect(checkOf(page, 'done-1')).toBeVisible()
    await expect(page.locator('.task-done-check--pop')).toHaveCount(0)
  })

  test('reduced motion: the check is there at once and has no animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoBoard(page)
    await card(page, OPEN.id).focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('erledigt')
    await page.keyboard.press('Enter')

    const check = checkOf(page, OPEN.id)
    await expect(check).toBeVisible()
    expect(await animationOf(check)).toBe('none')
    await expect(check).toHaveCSS('opacity', '1')
    // No stuck pop class: animationend never fires without an animation
    await expect(check).not.toHaveClass(/task-done-check--pop/)
  })
})
