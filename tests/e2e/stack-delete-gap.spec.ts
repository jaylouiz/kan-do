import { test, expect, type Locator, type Page } from '@playwright/test'
import { elapseWindow, GAP_CLOSE_MS, installClock, UNDO_WINDOW_MS } from './helpers/clock'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { focusUntilActive } from './helpers/settle'

/**
 * The delete gap of a card that sits inside a collapsed stack (#433). The card has no wrapper of its own while
 * the stack is collapsed, so its gap used to land at the column end at the default card height. Sequences, not
 * single calls: palette delete -> gap below the stack -> undo -> back in the stack at its place; palette delete
 * -> window elapses -> trash receives it.
 */

const NOW = new Date().toISOString()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null, topic: null, custom: {}, createdAt: NOW, updatedAt: NOW, ...o,
})

// Rendered Offen: u1, [a1 a2 a3], c1, d1  (the stack is collapsed after a reload)
const OPEN = [
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
  task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
  task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
]
const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }
const DESIGN = (ids: string[]) => ids.map(id => task({ id, title: `Design ${id}`, status: 0, topic: 'Design' }))

const LIST = '#column-open-list'
const stack = (page: Page) => page.locator(`${LIST} .task-stack[data-stack-key="Design"]`)
const member = (page: Page, title: string) => page.locator(`${LIST} .task-wrapper[data-from-stack="Design"]`, { hasText: title })
const gap = (page: Page) => page.locator(`${LIST} .task-gap`)
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })

/** Item keys of the open column in render order: card id, `stack:<key>`, `header:<key>` (expanded stack) or `gap`. */
const itemOrder = (page: Page) =>
  page.locator(LIST).evaluate(list =>
    [...list.querySelectorAll<HTMLElement>('.task-wrapper, .task-stack, .task-gap, [data-stack-header]')].map(el =>
      el.classList.contains('task-gap')
        ? 'gap'
        : el.classList.contains('task-stack')
          ? `stack:${el.dataset.stackKey}`
          : el.hasAttribute('data-stack-header')
            ? `header:${el.getAttribute('data-stack-header')}`
            : el.dataset.taskId ?? '?'))

/** Like `itemOrder`, but a gap names the card it replaced: `gap:<id>`. */
const itemOrderWithGapIds = (page: Page) =>
  page.locator(LIST).evaluate(list =>
    [...list.querySelectorAll<HTMLElement>('.task-wrapper, .task-stack, .task-gap, [data-stack-header]')].map(el =>
      el.classList.contains('task-gap')
        ? `gap:${el.dataset.gapId}`
        : el.classList.contains('task-stack')
          ? `stack:${el.dataset.stackKey}`
          : el.hasAttribute('data-stack-header')
            ? `header:${el.getAttribute('data-stack-header')}`
            : el.dataset.taskId ?? '?'))

const storedTrash = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(entry => entry.taskId))

/**
 * Delete from the card menu of a member of an EXPANDED stack (#438). The menu item is a click outside the column, so
 * the group collapses right after the delete read its slot from the expanded DOM; `ensureExpanded` opens it again.
 */
async function menuDeleteExpanded(page: Page, id: string) {
  await page.locator(`${LIST} .task-wrapper[data-task-id="${id}"] .task`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Löschen/ }).first().click()
}

/** Expands the Design stack when it is collapsed (idempotent, so it can sit inside a poll). */
async function ensureExpanded(page: Page) {
  await expect.poll(async () => {
    if (await page.locator(`${LIST} [data-stack-header="Design"]`).count() > 0) return true
    if (await stack(page).count() > 0) await stack(page).click()
    return false
  }).toBe(true)
}

/**
 * Focuses `card` (`focusUntilActive`) and opens the palette on it. Ctrl+K reads the focused card the instant it
 * fires; a press that wins the race opens the palette without the card's commands, "Keine Befehle" (#572, #574).
 */
async function focusAndOpenPalette(page: Page, card: Locator) {
  await focusUntilActive(card)
  await page.keyboard.press('ControlOrMeta+k')
}

/**
 * Expands the stack, puts keyboard focus on a member, opens the palette and clicks into its search field. That click
 * is outside the column, so the stack collapses again behind the palette: the card is gone from the DOM, yet the
 * palette still targets it. Delete then runs on a card inside a collapsed stack.
 */
async function paletteDelete(page: Page, title: string) {
  await stack(page).click()
  const card = member(page, title)
  await expect(card).toBeVisible()
  await focusAndOpenPalette(page, card)
  await expect(palette(page)).toBeVisible()
  // The palette lists the focused card's commands once it has read the focus: collapse the stack only after that
  await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toBeVisible()
  await palette(page).getByRole('textbox', { name: 'Befehl suchen…' }).click()
  await expect(stack(page)).toBeVisible()
  await expect(card).toHaveCount(0)
  await page.keyboard.type('löschen')
  // Enter runs the highlighted row: wait until the filter has settled on the delete row
  await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toHaveAttribute('data-highlighted', '')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
}

/**
 * Palette delete on the focused `card` with no click anywhere (#457): the same guards as `paletteDelete` (focus held,
 * the card's commands listed before typing, the filter settled before Enter, #572, #574), without the click into the
 * search field, so the stack stays open.
 */
async function paletteDeleteByKeyboard(page: Page, card: Locator) {
  await focusAndOpenPalette(page, card)
  await expect(palette(page)).toBeVisible()
  await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toBeVisible()
  await page.keyboard.type('löschen')
  await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toHaveAttribute('data-highlighted', '')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
}

test.describe('delete from the palette of a card inside a stack (#433)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test.beforeEach(async ({ context, page }) => {
    await installClock(context) // the window is driven with the page clock (#543)
    await seedLocalBoard(context, OPEN, {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  test('the gap sits directly below the stack compact, undo puts the card back into the stack, and again', async ({ page }) => {
    await paletteDelete(page, 'Farben abstimmen')

    await expect(gap(page)).toHaveCount(1)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])
    // the stack still holds the other two cards
    await expect(stack(page)).toHaveAttribute('data-stack-size', '2')
    // compact (#57, #293): the collapsed Yesterday note's 48px, not the stack's slot (the box glides there in 220 ms)
    await expect.poll(async () => (await gap(page).boundingBox())!.height).toBeCloseTo(48, 0)
    const gapBox = await gap(page).boundingBox()
    const nextBox = await page.locator(`${LIST} .task-wrapper[data-task-id="c1"]`).boundingBox()
    expect(nextBox!.y).toBeGreaterThanOrEqual(gapBox!.y + gapBox!.height - 1)

    // undo: the card is back in its stack, at its place (a1 a2 a3)
    await gap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(gap(page)).toHaveCount(0)
    await expect(stack(page)).toHaveAttribute('data-stack-size', '3')
    await expect.poll(() => stack(page).getAttribute('data-stack-task-ids')).toBe('["a1","a2","a3"]')
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'c1', 'd1'])

    // A -> B -> A: delete the same card again, the gap is at the stack again, and nothing is lost
    await paletteDelete(page, 'Farben abstimmen')
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])
  })

  test('the window elapsing sends the card to the trash; the gap stays at the stack until then and goes after', async ({ page }) => {
    await paletteDelete(page, 'Konzept ausarbeiten')

    // front card deleted: the gap is still below the stack
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])
    expect(await storedTrash(page)).not.toContain('a1')

    await elapseWindow(page)
    await expect.poll(() => storedTrash(page)).toContain('a1')
    await expect(gap(page)).toHaveCount(0)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'c1', 'd1'])
  })

  test('deleting an unstacked card leaves its gap in its own slot as before', async ({ page }) => {
    const card = page.locator(`${LIST} .task-wrapper[data-task-id="c1"]`)
    // Same guards as paletteDelete (#572): wait for the card's commands before typing, and for the filter before Enter
    await focusAndOpenPalette(page, card)
    await expect(palette(page)).toBeVisible()
    await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toBeVisible()
    await page.keyboard.type('löschen')
    await expect(palette(page).getByRole('option', { name: /Löschen/ }).first()).toHaveAttribute('data-highlighted', '')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'd1'])
  })
})

test.describe('delete gap inside an expanded stack (#438)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  const seed = async (context: Parameters<typeof seedLocalBoard>[0], page: Page, members: string[]) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(members),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await stack(page).click()
    await expect(page.locator(`${LIST} [data-stack-header="Design"]`)).toBeVisible()
  }

  test('first member: the gap sits under the header, undo puts it back as first member, and again', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'])
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'a1', 'a2', 'a3', 'c1', 'd1'])

    await menuDeleteExpanded(page, 'a1')
    await expect(gap(page)).toHaveCount(1)
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'c1', 'd1'])

    await gap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(gap(page)).toHaveCount(0)
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'a1', 'a2', 'a3', 'c1', 'd1'])

    // A -> B -> A
    await menuDeleteExpanded(page, 'a1')
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'c1', 'd1'])
  })

  test('Delete on a focused member deletes it and focus moves to the next member (#579)', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'])
    await focusUntilActive(member(page, 'Design a2'))
    await page.keyboard.press('Delete')
    await expect(gap(page)).toHaveCount(1)
    await expect(member(page, 'Design a2')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.taskId ?? null)).toBe('a3')
  })

  test('the window elapsing closes the gap in place, the card is in the trash and the header counts the rest', async ({ page, context }) => {
    await installClock(context)
    await seed(context, page, ['a1', 'a2', 'a3'])
    await menuDeleteExpanded(page, 'a1')
    // the pointer may rest on the new gap (the menu item sat there), and hover pauses the window
    await page.mouse.move(2, 2)
    await elapseWindow(page)
    await expect.poll(() => storedTrash(page)).toContain('a1')
    await expect(gap(page)).toHaveCount(0)
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'a2', 'a3', 'c1', 'd1'])
    await expect(page.locator(`${LIST} [data-stack-header="Design"]`)).toContainText('2')
  })

  test('a middle member keeps its gap behind the previous member', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'])
    await menuDeleteExpanded(page, 'a2')
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'a1', 'gap', 'a3', 'c1', 'd1'])
  })

  test('the new first member deleted too: both gaps stay under the header in card order', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3', 'a4'])
    await menuDeleteExpanded(page, 'a1')
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'a4', 'c1', 'd1'])
    await menuDeleteExpanded(page, 'a2')
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'gap', 'a3', 'a4', 'c1', 'd1'])
    await expect(page.locator(`${LIST} .task-gap`).first()).toHaveAttribute('data-gap-id', 'a1')
  })

  test('a stack of two loses its header when the first member goes: the gap sits above the lone card', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2'])
    await menuDeleteExpanded(page, 'a1')
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'gap', 'a2', 'c1', 'd1'])
  })

  test('a stack of three dissolved by two deletes keeps both gaps above the lone third card', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'])
    await menuDeleteExpanded(page, 'a1')
    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'c1', 'd1'])
    await menuDeleteExpanded(page, 'a2')
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'gap', 'gap', 'a3', 'c1', 'd1'])
  })

  test('collapsing the group while the window is open moves the gap below the stack, expanding moves it back', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'])
    await menuDeleteExpanded(page, 'a1')
    // the menu click collapsed the group: the gap sits directly below the collapsed stack (#433)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])

    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'c1', 'd1'])

    await page.locator(`${LIST} [data-stack-header="Design"] button`).click()
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])

    await ensureExpanded(page)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'header:Design', 'gap', 'a2', 'a3', 'c1', 'd1'])
  })
})

test.describe('a gap whose anchor is deleted during a paused window (#438)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('g2 elapses while the hovered g1 is paused: g1 stays below the stack, not at the column end', async ({ page, context }) => {
    await installClock(context)
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2', 'a3', 'a4']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()

    await paletteDelete(page, 'Design a1')
    await paletteDelete(page, 'Design a2')
    await expect(gap(page)).toHaveCount(2)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'gap', 'c1', 'd1'])

    // pause g1 (the older one, directly behind g2): its window outlives g2's
    const g1 = page.locator(`${LIST} .task-gap[data-gap-id="a1"]`)
    await g1.hover()
    await elapseWindow(page)
    await expect(gap(page)).toHaveCount(1)
    await expect.poll(() => itemOrder(page)).toEqual(['u1', 'stack:Design', 'gap', 'c1', 'd1'])
    await expect(g1).toHaveCount(1)
  })
})

test.describe('the whole expanded stack deleted while the gaps are open (#457)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  const seed = async (context: Parameters<typeof seedLocalBoard>[0], page: Page, members: string[], withBefore = true) => {
    await seedLocalBoard(context, [
      ...(withBefore ? [task({ id: 'u1', title: 'Dokumentation lesen', status: 0 })] : []),
      ...DESIGN(members),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await stack(page).click()
    await expect(page.locator(`${LIST} [data-stack-header="Design"]`)).toBeVisible()
  }

  /** Deletes the given members one by one from the card menu, expanding the stack first while it exists. */
  const deleteAll = async (page: Page, ids: string[]) => {
    for (const id of ids) {
      if (await page.locator(`${LIST} .task-wrapper[data-task-id="${id}"]`).count() === 0) await ensureExpanded(page)
      await menuDeleteExpanded(page, id)
      await expect(page.locator(`${LIST} .task-gap[data-gap-id="${id}"]`)).toHaveCount(1)
    }
  }

  test('stack of 2: both gaps stay where the stack stood, undo of each, and again (A -> B -> A)', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2'])
    await deleteAll(page, ['a1', 'a2'])
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])

    // the last-deleted member first: it is back, the other gap stays
    await page.locator(`${LIST} .task-gap[data-gap-id="a2"]`).getByRole('button', { name: /Rückgängig/ }).click()
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'a2', 'c1', 'd1'])
    // A -> B -> A: delete it again
    await menuDeleteExpanded(page, 'a2')
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'c1', 'd1'])

    // the first-deleted member: back at its slot; the gap of a2 hangs on it and follows it (#477)
    await page.locator(`${LIST} .task-gap[data-gap-id="a1"]`).getByRole('button', { name: /Rückgängig/ }).click()
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'a1', 'gap:a2', 'c1', 'd1'])
  })

  for (const order of [['a1', 'a2', 'a3'], ['a3', 'a2', 'a1'], ['a2', 'a1', 'a3']]) {
    test(`stack of 3 deleted in the order ${order.join(', ')}: three gaps in card order between u1 and c1`, async ({ page, context }) => {
      await seed(context, page, ['a1', 'a2', 'a3'])
      await deleteAll(page, order)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    })
  }

  // A -> B -> A on a member whose gap hangs on the shared place: the re-deleted gap lands in card order again (matrix: unit test)
  for (const [order, again] of [[['a1', 'a2', 'a3'], 'a1'], [['a2', 'a1', 'a3'], 'a3']] as const) {
    test(`stack of 3 deleted in the order ${order.join(', ')}: undo ${again} and delete it again gives the same order`, async ({ page, context }) => {
      await seed(context, page, ['a1', 'a2', 'a3'])
      await deleteAll(page, [...order])
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
      await page.locator(`${LIST} .task-gap[data-gap-id="${again}"]`).getByRole('button', { name: /Rückgängig/ }).click()
      await expect(page.locator(`${LIST} .task-wrapper[data-task-id="${again}"]`)).toBeVisible()
      await menuDeleteExpanded(page, again)
      await expect(page.locator(`${LIST} .task-gap[data-gap-id="${again}"]`)).toHaveCount(1)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    })
  }

  test('a stack in the first position of the column: the gaps stay at the top, not at the end', async ({ page, context }) => {
    await seed(context, page, ['a1', 'a2', 'a3'], false)
    await deleteAll(page, ['a1', 'a2', 'a3'])
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['gap:a1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })

  test('the first gap elapses before the last member is deleted: the others stay at the stack and the trash has each card', async ({ page, context }) => {
    await installClock(context)
    await seed(context, page, ['a1', 'a2', 'a3'])
    await deleteAll(page, ['a1'])
    await page.mouse.move(2, 2)
    await elapseWindow(page)
    await expect.poll(() => storedTrash(page)).toContain('a1')
    await expect(page.locator(`${LIST} .task-gap[data-gap-id="a1"]`)).toHaveCount(0)
    await deleteAll(page, ['a2', 'a3'])
    await page.mouse.move(2, 2)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
    await elapseWindow(page)
    await expect.poll(() => storedTrash(page)).toEqual(expect.arrayContaining(['a1', 'a2', 'a3']))
    await expect(gap(page)).toHaveCount(0)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'c1', 'd1'])
  })

  // The windows run on the page clock, not on real time (#509): "a1 elapsed while a2 is still open" is a state the test
  // sets up, not a margin between two 5 s timers that machine load can eat.
  test('a gap whose window elapses before the last member is deleted: the gaps behind it keep the stack place', async ({ page, context }) => {
    await page.clock.install()
    await seed(context, page, ['a1', 'a2', 'a3'])
    await page.clock.pauseAt(new Date(Date.now() + 60_000))
    await deleteAll(page, ['a1'])
    await page.clock.runFor(2000)
    await deleteAll(page, ['a2'])
    await page.mouse.move(2, 2)
    // a1's window ends 5 s after its delete, a2's 2 s later; the run stops 1 s after a1's, past its closing glide
    await page.clock.runFor(UNDO_WINDOW_MS - 2000 + GAP_CLOSE_MS + 1000)
    await expect.poll(() => storedTrash(page)).toEqual(['a1'])
    await expect(page.locator(`${LIST} .task-gap[data-gap-id="a1"]`)).toHaveCount(0)
    await expect(page.locator(`${LIST} .task-gap[data-gap-id="a2"]`)).toHaveCount(1)
    await deleteAll(page, ['a3'])
    await page.mouse.move(2, 2)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a2', 'gap:a3', 'c1', 'd1'])
  })
})

test.describe('gap order follows the card order after undo and across stacks (#477)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  const GROUP_OF: Record<string, string> = { a1: 'Design', a2: 'Design', o1: 'Ops', o2: 'Ops' }
  const undoGap = (page: Page, id: string) =>
    page.locator(`${LIST} .task-gap[data-gap-id="${id}"]`).getByRole('button', { name: /Rückgängig/ }).click()

  /** Expands a group when its stack is collapsed (idempotent, so it can sit inside a poll). */
  async function expandGroup(page: Page, group: string) {
    await expect.poll(async () => {
      if (await page.locator(`${LIST} [data-stack-header="${group}"]`).count() > 0) return true
      const collapsed = page.locator(`${LIST} .task-stack[data-stack-key="${group}"]`)
      if (await collapsed.count() > 0) await collapsed.click()
      return false
    }).toBe(true)
  }

  /** Deletes one by one from the card menu, expanding the card's group first when it is not rendered as a card. */
  async function deleteSeq(page: Page, ids: string[]) {
    for (const id of ids) {
      const group = GROUP_OF[id]
      if (group !== undefined && await page.locator(`${LIST} .task-wrapper[data-task-id="${id}"]`).count() === 0) await expandGroup(page, group)
      await menuDeleteExpanded(page, id)
      await expect(page.locator(`${LIST} .task-gap[data-gap-id="${id}"]`)).toHaveCount(1)
    }
  }

  test('F0: unstacked u1 c1 d1: delete c1 then d1, undo c1 puts the gap of d1 behind it, undo d1 restores the column', async ({ page, context }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(page.locator(`${LIST} .task-wrapper[data-task-id="d1"]`)).toBeVisible()

    await deleteSeq(page, ['c1', 'd1'])
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:c1', 'gap:d1'])
    await undoGap(page, 'c1')
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'c1', 'gap:d1'])
    await undoGap(page, 'd1')
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'c1', 'd1'])

    // the other order: delete d1 first, then c1; undo d1 leaves the gap of c1 above it
    await deleteSeq(page, ['d1', 'c1'])
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:c1', 'gap:d1'])
    await undoGap(page, 'd1')
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:c1', 'd1'])
  })

  for (const order of [['a1', 'a2', 'o1', 'o2'], ['o1', 'a1', 'o2', 'a2'], ['a2', 'o2', 'a1', 'o1']]) {
    test(`F2: two adjacent stacks deleted in the order ${order.join(', ')}: the gaps of the first stack, then of the second`, async ({ page, context }) => {
      await seedLocalBoard(context, [
        task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
        ...DESIGN(['a1', 'a2']),
        ...['o1', 'o2'].map(id => task({ id, title: `Ops ${id}`, status: 0, topic: 'Ops' })),
        task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
      ], {}, GROUP_BY_TOPIC, { once: true })
      await page.goto('/tasks')
      await expandGroup(page, 'Design')
      await expandGroup(page, 'Ops')
      await deleteSeq(page, order)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'gap:a2', 'gap:o1', 'gap:o2', 'd1'])
    })
  }

  for (const order of [['a1', 'x1', 'a2'], ['x1', 'a1', 'a2'], ['a1', 'a2', 'x1']]) {
    test(`F3: u1 x1 [a1 a2] deleted in the order ${order.join(', ')}: gap:x1 stays in front of the stack's gaps, undo x1 puts the card there`, async ({ page, context }) => {
      await seedLocalBoard(context, [
        task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
        task({ id: 'x1', title: 'Einzelkarte', status: 0 }),
        ...DESIGN(['a1', 'a2']),
        task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      ], {}, GROUP_BY_TOPIC, { once: true })
      await page.goto('/tasks')
      await expandGroup(page, 'Design')
      await deleteSeq(page, order)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:x1', 'gap:a1', 'gap:a2', 'c1'])
      await undoGap(page, 'x1')
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'x1', 'gap:a1', 'gap:a2', 'c1'])
    })
  }
})

test.describe('palette delete of the first and last member after a click into the search field (#457)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2', 'a3']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  const cases: Array<[string, string, string[]]> = [
    ['a1', 'Design a1', ['u1', 'header:Design', 'gap:a1', 'a2', 'a3', 'c1', 'd1']],
    ['a2', 'Design a2', ['u1', 'header:Design', 'a1', 'gap:a2', 'a3', 'c1', 'd1']],
    ['a3', 'Design a3', ['u1', 'header:Design', 'a1', 'a2', 'gap:a3', 'c1', 'd1']],
  ]
  for (const [id, title, expanded] of cases) {
    test(`${id}: the gap sits below the collapsed stack and at the card's place once expanded; undo restores it`, async ({ page }) => {
      await paletteDelete(page, title)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'stack:Design', `gap:${id}`, 'c1', 'd1'])

      await ensureExpanded(page)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(expanded)

      await page.locator(`${LIST} .task-gap[data-gap-id="${id}"]`).getByRole('button', { name: /Rückgängig/ }).click()
      await expect(gap(page)).toHaveCount(0)
      await ensureExpanded(page)
      await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'header:Design', 'a1', 'a2', 'a3', 'c1', 'd1'])
    })
  }
})

test.describe('palette delete of a card of a collapsed stack of two (#457)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('the first member deleted: the gap stays directly above the remaining, now lone, card (#502)', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
    await paletteDelete(page, 'Design a1')
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'a2', 'c1'])
  })
})

test.describe('palette delete of two cards of a collapsed stack (#502)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('a2 then a3, undo a2: expanded, a2 is back in front of the gap of a3', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2', 'a3']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
    await paletteDelete(page, 'Design a2')
    await expect(gap(page)).toHaveCount(1)
    await paletteDelete(page, 'Design a3')
    await expect(gap(page)).toHaveCount(2)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'a1', 'gap:a2', 'gap:a3', 'c1'])

    await page.locator(`${LIST} .task-gap[data-gap-id="a2"]`).getByRole('button', { name: /Rückgängig/ }).click()
    await ensureExpanded(page)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'header:Design', 'a1', 'a2', 'gap:a3', 'c1'])
  })
})

test.describe('palette delete without any click (#457)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('the gap sits under the header, undo restores the first member as first member', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2', 'a3']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0, topic: 'Docs' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await stack(page).click()
    const card = member(page, 'Design a1')
    await expect(card).toBeVisible()
    await paletteDeleteByKeyboard(page, card)

    // Enter's activation is a click without a pointer on the palette item: it is no outside click, the stack stays open (#476)
    await expect(stack(page)).toHaveCount(0)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'header:Design', 'gap:a1', 'a2', 'a3', 'c1', 'd1'])
    // focus lands on the next member, not on body
    await expect(member(page, 'Design a2')).toBeFocused()

    await gap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(gap(page)).toHaveCount(0)
    await ensureExpanded(page)
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'header:Design', 'a1', 'a2', 'a3', 'c1', 'd1'])
  })

  test('Escape still collapses the stack that stayed open, and an outside click does too', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2', 'a3']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await stack(page).click()
    await paletteDeleteByKeyboard(page, member(page, 'Design a1'))
    await expect(member(page, 'Design a2')).toBeFocused()
    await expect(stack(page)).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(stack(page)).toBeVisible()
    // A -> B -> A: open again, an outside click collapses it
    await stack(page).click()
    await expect(stack(page)).toHaveCount(0)
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await expect(stack(page)).toBeVisible()
  })
})

test.describe('palette delete without any click, stack of two (#457)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('the delete read the expanded stack: the gap sits above the remaining, now lone, card (a collapsed read would put it below)', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      ...DESIGN(['a1', 'a2']),
      task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
    ], {}, GROUP_BY_TOPIC, { once: true })
    await page.goto('/tasks')
    await stack(page).click()
    const card = member(page, 'Design a1')
    await expect(card).toBeVisible()
    await paletteDeleteByKeyboard(page, card)
    // no ensureExpanded: the stack of two dissolved, so the two reads differ in the final order
    await expect.poll(() => itemOrderWithGapIds(page)).toEqual(['u1', 'gap:a1', 'a2', 'c1'])
  })
})

test.describe('Delete key next to an open gap (#579)', () => {
  test('a second Delete steps over the first one\'s gap and focuses the next card', async ({ page, context }) => {
    await seedLocalBoard(context, [
      task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
      task({ id: 'c1', title: 'Release planen', status: 0 }),
      task({ id: 'd1', title: 'Ablage sortieren', status: 0 }),
    ], {}, undefined, { once: true })
    await page.goto('/tasks')
    const activeId = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.taskId ?? null)
    const card = (id: string) => page.locator(`${LIST} .task-wrapper[data-task-id="${id}"]`)

    await focusUntilActive(card('c1'))
    await page.keyboard.press('Delete')
    await expect.poll(activeId).toBe('d1')
    // u1 now has the gap of c1 behind it, d1 behind the gap
    await focusUntilActive(card('u1'))
    await page.keyboard.press('Delete')
    await expect(gap(page)).toHaveCount(2)
    await expect.poll(activeId).toBe('d1')
  })
})
