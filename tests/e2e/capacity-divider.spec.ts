import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, seedWorkHistory, type SeedTask } from './helpers/seed'
import { pickUp, hover, dropSettled } from './helpers/dnd'
import { settleAnimations } from './helpers/settle'

/**
 * #132: the Kapazität divider in the Offen list. Planned time = remaining time box of Jetzt, Wartet and Offen (a card
 * without a box counts 30 min) against the day's capacity: 6 h until the app has 5 tracked days to learn from.
 * Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
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
const hours = (h: number) => h * 3600
const open = (id: string, h: number | null): SeedTask =>
  task({ id, title: `Karte ${id}`, status: 0, timeBoxSeconds: h === null ? null : hours(h) })

const list = (page: Page) => page.locator('#column-open-list')
const divider = (page: Page) => page.getByTestId('capacity-divider')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)

/** The task ids of the Offen list in DOM order with the divider as `|`: "a b | c". */
const layout = (page: Page) =>
  list(page).locator(':scope > .task-wrapper, :scope > .task-stack, :scope > [data-testid="capacity-divider"]')
    .evaluateAll(els => els.map(el => el.getAttribute('data-task-id') ?? '|').join(' '))

async function gotoBoard(page: Page, firstCard: string) {
  await page.goto('/tasks')
  await expect(card(page, firstCard)).toBeVisible()
  await settleAnimations(page)
}

// tall enough that the fourth card is on screen for the drag
test.use({ viewport: { width: 1280, height: 1100 } })

test.describe('Capacity divider in Offen (#132)', () => {
  test('sits right after the card that exactly fills the 6 h day, the rest follows below it', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 3), open('b', 2), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect(divider(page)).toBeVisible()
    await expect.poll(() => layout(page)).toBe('a b c | d')
    await expect(divider(page).getByRole('separator', { name: 'Kapazität' })).toBeVisible()
    await expect(divider(page)).toContainText('Plane Wichtiges darüber ein')
  })

  test('is not there when everything fits', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 2), open('b', 1), open('c', null)])
    await gotoBoard(page, 'a')
    await expect(divider(page)).toHaveCount(0)
    await expect.poll(() => layout(page)).toBe('a b c')
  })

  test('is not there when Offen is empty, however full the day already is', async ({ context, page }) => {
    await seedLocalBoard(context, [task({ id: 'w1', title: 'Wartet', status: 2, timeBoxSeconds: hours(9) })])
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper[data-task-id="w1"]')).toBeVisible()
    await expect(divider(page)).toHaveCount(0)
  })

  test('counts Jetzt and Wartet first and a card without a box as 30 minutes', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'now', title: 'Jetzt', status: 1, timeBoxSeconds: hours(2), timeSpentSeconds: 0 }),
      task({ id: 'wait', title: 'Wartet', status: 2, timeBoxSeconds: hours(2) }),
      open('a', 1), open('b', null), open('c', null), open('d', 1),
    ])
    await gotoBoard(page, 'a')
    // 2 h + 2 h + 1 h + 0.5 h + 0.5 h = 6 h: full after c
    await expect.poll(() => layout(page)).toBe('a b c | d')
  })

  test('learns the length of the day: five tracked 3 h days make 3 h the capacity', async ({ context, page }) => {
    await seedWorkHistory(context, 5, 3)
    await seedLocalBoard(context, [open('a', 1), open('b', 1), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d')
  })

  test('reads malformed stored history as no history (6 h day)', async ({ context, page }) => {
    await context.addInitScript(() => {
      localStorage.setItem('taskStatistics', JSON.stringify({ workSessions: [null, { start: 'x' }, 'y', { start: 5, end: 1 }] }))
    })
    await seedLocalBoard(context, [open('a', 3), open('b', 3), open('c', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b | c')
  })

  test('a card without a box counts what similar done tasks took, a boxed card keeps its box (#302)', async ({ context, page }) => {
    const done = (i: number) => ({
      taskId: `done-${i}`, title: 'Bericht schreiben', completedAt: NOW, timeBoxSeconds: null, actualTimeSpentSeconds: hours(2),
      estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false,
    })
    await context.addInitScript((records) => {
      localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords: records }))
    }, [done(1), done(2), done(3)])
    await seedLocalBoard(context, [
      task({ id: 'a', title: 'Bericht schreiben', status: 0 }),
      task({ id: 'b', title: 'Bericht schreiben', status: 0 }),
      open('c', 1), open('d', 1), open('e', 1),
    ])
    await gotoBoard(page, 'a')
    // 2 h + 2 h (learned) + 1 h + 1 h = 6 h: full after d; with the fixed 30 min the day would not be full at all
    await expect.poll(() => layout(page)).toBe('a b c d | e')
  })

  test('without enough history a card without a box stays at 30 minutes (#302)', async ({ context, page }) => {
    await context.addInitScript(() => {
      const done = (i: number) => ({ taskId: `done-${i}`, title: 'Bericht schreiben', completedAt: new Date().toISOString(), actualTimeSpentSeconds: 7200 })
      localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords: [done(1), done(2)] }))
    })
    await seedLocalBoard(context, [task({ id: 'a', title: 'Bericht schreiben', status: 0 }), open('b', 3), open('c', 2), open('d', 1), open('e', 1)])
    await gotoBoard(page, 'a')
    // 0.5 h + 3 h + 2 h + 1 h = 6.5 h: full after d (learned, a would count 2 h and fill the day after c); two similar tasks are too few
    await expect.poll(() => layout(page)).toBe('a b c d | e')
  })

  test('the info button is keyboard reachable and opens the popover that says the estimate learns', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 6), open('b', 1)])
    await gotoBoard(page, 'a')
    const info = page.getByTestId('capacity-info')
    await info.focus()
    await expect(info).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('capacity-info-text')).toContainText('lernt mit')
    await expect(page.getByTestId('capacity-info-estimates')).toContainText('Ohne genug ähnliche Aufgaben zählt sie 30 Minuten')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('capacity-info-text')).toHaveCount(0)
  })

  test('a working day set in Einstellungen replaces the learned one, survives a reload and ends with Automatisch (#306)', async ({ context, page }) => {
    await seedWorkHistory(context, 5, 5) // learned: 5 h, so 4 cards of 1 h fit
    await seedLocalBoard(context, [open('a', 1), open('b', 1), open('c', 1), open('d', 1)], {}, undefined, { once: true })
    await gotoBoard(page, 'a')
    await expect(divider(page)).toHaveCount(0)

    await page.goto('/settings')
    const select = page.getByTestId('working-hours-select')
    await expect(select).toContainText('Automatisch')
    await select.click()
    await page.getByRole('option', { name: '3 h', exact: true }).click()
    await expect(select).toContainText('3 h')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').workingHoursMinutes)).toBe(180)

    await page.goto('/tasks')
    await expect(card(page, 'a')).toBeVisible()
    await expect.poll(() => layout(page)).toBe('a b c | d')
    await page.getByTestId('capacity-info').click()
    await expect(page.getByTestId('capacity-info-text')).toContainText('Arbeitszeit')
    await page.keyboard.press('Escape')

    await page.reload() // A -> B -> reload: still B
    await expect.poll(() => layout(page)).toBe('a b c | d')

    await page.goto('/settings')
    await select.click()
    await page.getByRole('option', { name: 'Automatisch' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').workingHoursMinutes)).toBeNull()
    await page.goto('/tasks')
    await expect(card(page, 'a')).toBeVisible()
    await expect(divider(page)).toHaveCount(0)
  })

  test('a set working day is not held to the 2-10 h clamp of the learned one (12 h)', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 8), open('b', 3), open('c', 2), open('d', 1)])
    await context.addInitScript(() => localStorage.setItem('settings-store', JSON.stringify({ focusEnabled: false, workingHoursMinutes: 720 })))
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d') // 8 + 3 + 2 = 13 h reaches 12 h at c; the learned clamp (10 h) would end the day after b
  })

  test('a malformed stored working day reads as Automatisch (6 h day) and shows as such in Einstellungen', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 3), open('b', 3), open('c', 1)])
    await context.addInitScript(() => localStorage.setItem('settings-store', JSON.stringify({ focusEnabled: false, workingHoursMinutes: 100 })))
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b | c')
    await page.goto('/settings')
    await expect(page.getByTestId('working-hours-select')).toContainText('Automatisch')
  })

  test('moves when a card is dragged above it (A -> B -> A) and is no drag target itself', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 4), open('b', 1), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d')

    // d above a: d a b c, 1 + 4 = 5 h, b fills the day
    await pickUp(page, card(page, 'd'))
    await hover(page, card(page, 'a'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('d a b | c')

    // and back: a before d. a d b c: 4 + 1 = 5, b is at 6
    await pickUp(page, card(page, 'a'))
    await hover(page, card(page, 'd'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('a d b | c')
    await expect(divider(page)).toHaveCount(1)
  })

  test('stays out of the other columns', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 6), open('b', 1),
      task({ id: 'w1', title: 'W', status: 2, timeBoxSeconds: hours(8) })])
    await gotoBoard(page, 'a')
    const count = (sel: Locator) => sel.getByTestId('capacity-divider').count()
    expect(await count(page.locator('#column-waiting-list'))).toBe(0)
    expect(await count(page.locator('#column-progress-list'))).toBe(0)
    expect(await count(page.locator('#column-done-list'))).toBe(0)
  })
})

/**
 * #817: "Heute" on "Alle" lists the Jetzt and Wartet cards behind Offen's own, and the line counts their time first, so
 * on a full day they stand above it. The ids of the list top to bottom, the line as `|`, the extras by their own ids.
 */
test.describe('"Heute" on "Alle" and the capacity line (#817)', () => {
  const nowCard = task({ id: 'now', title: 'Jetzt', status: 1, timeBoxSeconds: hours(2) })
  const w1 = task({ id: 'w1', title: 'Wartet 1', status: 2, timeBoxSeconds: hours(2) })
  const w2 = task({ id: 'w2', title: 'Wartet 2', status: 2 })
  /** 2 h + 2 h + 0.5 h used, a 1 h and b 0.5 h fill the 6 h day */
  const FULL: SeedTask[] = [nowCard, w1, w2, open('a', 1), open('b', null), open('c', null), open('d', 1)]

  async function gotoAll(page: Page) {
    await page.goto('/all')
    await expect(page.locator('.board')).toHaveAttribute('data-place', 'all')
    await expect(card(page, 'a')).toBeVisible()
    await settleAnimations(page)
  }

  test('on a full day the Jetzt and Wartet cards stand above the line, behind the cards that fit; Offen on Heute is unchanged', async ({ context, page }) => {
    await seedLocalBoard(context, FULL)
    await gotoAll(page)
    await expect.poll(() => layout(page)).toBe('a b now w1 w2 | c d')
    // each is still the one card of its task
    await expect(page.locator('[data-task-id="now"].task-wrapper')).toHaveCount(1)
    await expect(card(page, 'w1').getByTestId('task-status-badge')).toHaveText('Wartet')
    await page.getByTestId('app-nav-place-board').click()
    await expect(page.locator('.board')).toHaveAttribute('data-place', 'today')
    await settleAnimations(page)
    await expect.poll(() => layout(page)).toBe('a b | c d')
  })

  test('on a day that is not full there is no line and the order stays Offen, Jetzt, Wartet', async ({ context, page }) => {
    await seedLocalBoard(context, [nowCard, w1, open('a', 1), open('b', null)])
    await gotoAll(page)
    // 2 + 2 + 1 + 0.5 = 5.5 h: it fits
    await expect.poll(() => layout(page)).toBe('a b now w1')
    await expect(divider(page)).toHaveCount(0)
  })

  test('sorting keeps the extras above the line: a Wartet card among the Wartet cards, an Offen card across the line', async ({ context, page }) => {
    await seedLocalBoard(context, FULL)
    await gotoAll(page)
    await pickUp(page, card(page, 'w2'))
    await hover(page, card(page, 'w1'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('a b now w2 w1 | c d')

    // c above a: 4.5 + 0.5 + 1 = 6 h, the line moves behind a and the extras with it
    await pickUp(page, card(page, 'c'))
    await hover(page, card(page, 'a'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('c a now w2 w1 | b d')
  })

  // #833 review: the node put back after a drag that changes nothing went behind the last Offen card above the line
  // (the line's own card, a card that was last below it). Vue patches nothing then, so the DOM stayed wrong.
  // Both sides of the line: the card the line follows (`a b | c d`) and the only card below it (`a b | c`, the review's probe)
  for (const place of ['Heute', 'Alle'] as const) {
    for (const id of ['b', 'c']) {
      const seed = id === 'c' ? FULL.filter(t => t.id !== 'd') : FULL
      const below = id === 'c' ? 'c' : 'c d'
      const expected = place === 'Alle' ? `a b now w1 w2 | ${below}` : `a b | ${below}`
      test(`${place}: ${id === 'b' ? 'the card the line follows' : 'the only card below the line'} keeps its side of the line after a cancel and a drop in place`, async ({ context, page }) => {
        await seedLocalBoard(context, seed)
        if (place === 'Alle') await gotoAll(page)
        else await gotoBoard(page, 'a')
        await expect.poll(() => layout(page)).toBe(expected)

        // Escape over another card: the node comes back from Offen's own list
        await pickUp(page, card(page, id))
        await hover(page, card(page, 'a'), { fromTop: 10 })
        await page.keyboard.press('Escape')
        await page.mouse.up()
        await dropSettled(page)
        await expect.poll(() => layout(page)).toBe(expected)

        // The canceled drag pushed the line below the window and showed the foot echo (#834): it is measured again at the
        // end of the drag, so it does not cover the card's centre (and the press below starts a drag)
        await expect(page.getByTestId('capacity-echo')).toHaveCount(0)
        const centre = await card(page, id).boundingBox()
        expect(centre).not.toBeNull()
        const hit = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('.task-wrapper')?.getAttribute('data-task-id') ?? null,
          { x: centre!.x + centre!.width / 2, y: centre!.y + centre!.height / 2 },
        )
        expect(hit).toBe(id)

        // Picked up and released where it was, pressed at its centre
        await pickUp(page, card(page, id))
        await page.mouse.up()
        await dropSettled(page)
        await expect.poll(() => layout(page)).toBe(expected)
      })
    }
  }
})
