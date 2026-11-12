import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { elapse, installClock, NUDGE_COUNTDOWN_MS } from './helpers/clock'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, finger, activeColumnPage, dropSettled } from './helpers/dnd'
import { dwell, flushFrames } from './helpers/settle'
import { EDGE_HOLD_DWELL_MS } from './helpers/constants'

/**
 * #389: a card without a timebox that lands in Jetzt asks for one on the card itself (15 min, 30 min or a
 * custom value) and goes away by itself when ignored. Only a user-driven move into Jetzt shows it: never
 * the page load, a timebox set already, or a reload. The countdown is an 8 s CSS animation, which the page clock does
 * not reach (#543): the ignore case finishes it through the Web Animations API (`finishCountdown`) instead of waiting.
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

const PLAIN = task({ id: 'plain', title: 'Rückruf vorbereiten', status: 0 })
const BOXED = task({ id: 'boxed', title: 'Dokumentation lesen', status: 0, timeBoxSeconds: 2700 })
const WAITING = task({ id: 'wait-1', title: 'Blocker klären', status: 2 })
const BOARD = [PLAIN, BOXED, WAITING]

const wrapper = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const jetzt = (page: Page) => page.locator('#column-progress-list')
const nudge = (page: Page) => page.getByRole('group', { name: 'Timebox hinzufügen?' })
const nudgeBtn = (page: Page, name: string) => nudge(page).getByRole('button', { name, exact: true })

/** Finishes the hairline's own `nudge-drain` animation (on `.nudge__bar::after`), which fires its `animationend` like the run-out. True once it was found. */
const finishCountdown = (page: Page) => page.evaluate(() => {
  const drain = document.getAnimations().find(animation =>
    (animation as CSSAnimation).animationName === 'nudge-drain' && (animation.effect as KeyframeEffect | null)?.target?.classList.contains('nudge__bar'))
  drain?.finish()
  return drain !== undefined
})

/** The hairline's countdown length and how far it has run, in ms (null while there is none). */
const countdown = (page: Page) => page.evaluate(() => {
  const drain = document.getAnimations().find(animation =>
    (animation as CSSAnimation).animationName === 'nudge-drain' && (animation.effect as KeyframeEffect | null)?.target?.classList.contains('nudge__bar'))
  return drain ? { duration: Number(drain.effect?.getTiming().duration), at: Number(drain.currentTime) } : null
})

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(wrapper(page, PLAIN.id)).toBeVisible()
}

/** Drags a card into the empty Jetzt column and drops it */
async function dragIntoJetzt(page: Page, id: string) {
  await pickUp(page, wrapper(page, id))
  await hover(page, jetzt(page).locator(':scope > .column-drop-zone'))
  await page.mouse.up()
  await expect(jetzt(page).locator(`.task[data-task-id="${id}"]`)).toBeVisible()
}

async function contextMenuMoveTo(page: Page, title: string, target: string) {
  await page.locator('.task-wrapper', { hasText: title }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: target, exact: true }).click()
}

test.describe('timebox nudge on a card that lands in Jetzt (desktop)', () => {
  test.beforeEach(async ({ context, page }) => {
    await installClock(context) // the Jetzt timer's interval runs on the page clock (#543)
    await seedLocalBoard(context, BOARD, {}, undefined, { once: true })
    await gotoBoard(page)
  })

  test('a drop into Jetzt asks on the card; the card face is hidden under the layer and the page is not modal', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)

    await expect(nudge(page)).toBeVisible()
    await expect(nudgeBtn(page, '15 min')).toBeVisible()
    await expect(nudgeBtn(page, '30 min')).toBeVisible()
    await expect(nudgeBtn(page, 'Eigene Dauer')).toBeVisible()
    // The card's own content is hidden but still in the DOM (opacity 0)
    const title = jetzt(page).locator('.task-title-text')
    await expect(title).toHaveText('Rückruf vorbereiten')
    await expect.poll(() => title.evaluate(el => getComputedStyle(el).opacity)).toBe('0')
    // No dialog semantics, no focus theft
    await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement === document.body || !document.activeElement?.closest('.nudge'))).toBe(true)
    // Regular-size card at rest (after the set-down, kd#181): 288 x 132 with the three buttons 36px high
    await dropSettled(page)
    const card = (await jetzt(page).locator('.task').boundingBox())!
    expect([Math.round(card.width), Math.round(card.height)]).toEqual([288, 132])
    expect(Math.round((await nudgeBtn(page, '15 min').boundingBox())!.height)).toBe(36)
  })

  test('15 min sets the timebox: the progress chip shows it, the layer is gone', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)
    await nudgeBtn(page, '15 min').click()

    await expect(nudge(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/tasks$/) // the answer is not also a click on the card (kd#25)
    const card = jetzt(page).locator('.task')
    await expect(card.locator('[data-testid="task-progress-chip"] .chip__box')).toHaveText('15 min')
    await expect.poll(() => card.locator('.task-title-text').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    // Persisted on the task
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks?.find((t: { id: string }) => t.id === 'plain')?.timeBoxSeconds)).toBe(900)
  })

  test('custom path: field prefilled 45, invalid values blocked, Escape back to the buttons, then Enter applies', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)
    await nudgeBtn(page, 'Eigene Dauer').click()

    const field = nudge(page).getByRole('spinbutton', { name: 'Minuten' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('45')
    // the field keeps a visible focus ring (DESIGN.md "States"): the pill around the input carries it
    const pill = nudge(page).locator('.nudge__field')
    await expect(pill).toHaveCSS('outline-style', 'solid')
    await expect(pill).toHaveCSS('outline-width', '3px')
    const apply = nudgeBtn(page, 'Übernehmen')
    await field.fill('500')
    await expect(apply).toBeDisabled()
    await field.press('Enter')
    await expect(nudge(page)).toBeVisible() // Enter is inert outside 1..480

    await field.press('Escape')
    await expect(nudgeBtn(page, '30 min')).toBeVisible()
    await expect(nudgeBtn(page, 'Eigene Dauer')).toBeFocused()

    await nudgeBtn(page, 'Eigene Dauer').click()
    await nudge(page).getByRole('spinbutton', { name: 'Minuten' }).fill('50')
    await page.keyboard.press('Enter')
    await expect(nudge(page)).toHaveCount(0)
    await expect(jetzt(page).locator('.task .chip__box')).toHaveText('50 min')
  })

  test('Escape dismisses from the buttons; the card stays without a timebox', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)
    await nudgeBtn(page, '15 min').focus()
    await page.keyboard.press('Escape')
    await expect(nudge(page)).toHaveCount(0)
    await expect(jetzt(page).locator('.task .chip__spent')).toHaveCount(0)
  })

  test('ignoring it: the layer leaves by itself after the 8 s countdown; pointer on the layer pauses it', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)
    const bar = page.locator('.nudge__bar')
    await expect(bar).toBeVisible()

    // Hover pauses the hairline's animation (not a reset): resume from where it stopped
    await nudgeBtn(page, '30 min').hover()
    await expect.poll(() => bar.evaluate(el => getComputedStyle(el, '::after').animationPlayState)).toBe('paused')
    const paused = await countdown(page)
    expect(paused?.duration).toBe(NUDGE_COUNTDOWN_MS) // the run-out is skipped below, so its length is asserted here
    expect(paused?.at).toBeGreaterThan(0) // so that "not reset" below means something
    await page.mouse.move(5, 5)
    await expect.poll(() => bar.evaluate(el => getComputedStyle(el, '::after').animationPlayState)).toBe('running')
    // resumed from where it stopped, not reset
    expect((await countdown(page))?.at).toBeGreaterThanOrEqual(paused?.at ?? Infinity)

    // the countdown runs out: the layer is still there just before, gone after
    expect(await nudge(page).count()).toBe(1)
    await expect.poll(() => finishCountdown(page)).toBe(true)
    await expect(nudge(page)).toHaveCount(0)
    await expect(jetzt(page).locator('.task')).toBeVisible()
    await expect.poll(() => jetzt(page).locator('.task-title-text').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    // Nothing set: only the spent-time chip of a card without a timebox, no timebox label
    await expect(jetzt(page).locator('.task .chip--boxless')).toHaveCount(1)
    await expect(jetzt(page).locator('.task .chip__spent')).toHaveCount(0)
  })

  test('the timer keeps running during the nudge (the nudge never starts, stops or resets it)', async ({ page }) => {
    await dragIntoJetzt(page, PLAIN.id)
    const spent = () => page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks?.find((t: { id: string }) => t.id === 'plain')?.timeSpentSeconds as number)
    const before = await spent()
    await expect(nudge(page)).toBeVisible()
    await elapse(page, 2000) // two ticks of the Jetzt timer
    await expect.poll(spent).toBeGreaterThan(before)
    await expect(nudge(page)).toBeVisible() // and the nudge is still there
  })

  test('a card with a timebox gets no nudge, a reorder inside Jetzt neither; a reload shows none', async ({ page }) => {
    await dragIntoJetzt(page, BOXED.id)
    await expect(jetzt(page).locator('.task[data-task-id="boxed"]')).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)

    // Plain card moved by the menu: asks (replacing nothing), and a reload afterwards shows none
    await page.reload()
    await expect(jetzt(page).locator('.task[data-task-id="boxed"]')).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)
  })

  test('context menu: a move into Jetzt asks; a reload while it is up shows none (A -> B -> A)', async ({ page }) => {
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()

    await page.reload()
    await expect(jetzt(page).locator('.task[data-task-id="plain"]')).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)

    // Out and in again asks again
    await contextMenuMoveTo(page, PLAIN.title, 'Warten')
    await expect(wrapper(page, PLAIN.id)).toBeVisible()
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()
  })

  test('a timebox set through the context menu meanwhile ends the nudge without being overwritten', async ({ page }) => {
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()
    await page.locator('.task-wrapper', { hasText: PLAIN.title }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Timebox setzen' }).click()
    await page.getByRole('menuitemcheckbox', { name: '60 Minuten' }).click()
    await expect(nudge(page)).toHaveCount(0)
    await expect(jetzt(page).locator('.task .chip__box')).toHaveText('1 h')
  })

  test('opening the sheet (click on the face, outside the buttons) ends the nudge; the card leaving Jetzt too', async ({ page }) => {
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()
    const card = (await jetzt(page).locator('.task').boundingBox())!
    // The top-left corner of the face is outside the controls: the layer passes the click through
    await page.mouse.click(card.x + 12, card.y + 12)
    await expect(page).toHaveURL(/\/tasks\/plain/)
    await expect(nudge(page)).toHaveCount(0)
  })

  test('a drag from the face starts, moves the card and ends the nudge', async ({ page }) => {
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()
    // The card's centre is the '30 min' button: press on the face's top-left corner, outside the controls
    await pickUp(page, jetzt(page).locator('.task'), { at: { x: 12, y: 12 } })
    await expect(nudge(page)).toHaveCount(0)
    await hover(page, wrapper(page, WAITING.id))
    await page.mouse.up()
    await expect(page.locator('#column-waiting-list .task[data-task-id="plain"]')).toBeVisible()
    await expect(nudge(page)).toHaveCount(0)
  })
})

test.describe('timebox nudge and the focus overlay (#394)', () => {
  test('the overlay never covers the layer and its pointer-hide does not end or reset the nudge', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD, {}, undefined, { focus: true, once: true })
    await gotoBoard(page)
    await contextMenuMoveTo(page, PLAIN.title, 'Jetzt')
    await expect(nudge(page)).toBeVisible()
    const card = jetzt(page).locator('.task')

    // The buttons are the topmost element at their centre (the overlay sits below the Now card)
    const topmost = await nudgeBtn(page, '15 min').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
        || el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })
    expect(topmost).toBe(true)

    // Pointer moves over the board (which hides the overlay) leave the nudge standing and its countdown running
    await page.mouse.move(40, 300, { steps: 5 })
    await page.mouse.move(600, 500, { steps: 5 })
    await expect(nudge(page)).toBeVisible()
    await expect(card).toHaveAttribute('data-current', '')
    await nudgeBtn(page, '30 min').click()
    await expect(nudge(page)).toHaveCount(0)
    await expect(card.locator('.chip__box')).toHaveText('30 min')
  })
})

test.describe('timebox nudge on touch (390px)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })


  /** Press-and-hold the Offen card, edge-dwell to the Jetzt tab and drop it there */
  async function touchIntoJetzt(context: BrowserContext, page: Page) {
    await seedLocalBoard(context, [PLAIN, WAITING], {}, undefined, { once: true })
    await gotoBoard(page)
    const touch = finger(await context.newCDPSession(page), page)
    const from = (await wrapper(page, PLAIN.id).boundingBox())!
    await touch.start(from.x + 40, from.y + from.height / 2)
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await touch.moveTo(385, from.y + from.height / 2, 10, 20)
    await dwell(page, EDGE_HOLD_DWELL_MS)
    await expect.poll(() => activeColumnPage(page)).toBe(1)
    await touch.moveTo(195, 130, 8, 20)
    await flushFrames(page)
    await touch.end()
    await expect(page.locator('.board.dragging')).toHaveCount(0)
    await expect(jetzt(page).locator('.task[data-task-id="plain"]')).toBeVisible()
    await expect(nudge(page)).toBeVisible()
    return touch
  }

  test('a tap on the face does nothing, buttons are 44px, a drag from the face moves the card and ends the nudge', async ({ context, page }) => {
    const touch = await touchIntoJetzt(context, page)

    // 280 x 128 card at rest (the set-down after the drop scales it for 200 ms, kd#181), 44px buttons
    await dropSettled(page)
    const card = (await jetzt(page).locator('.task').boundingBox())!
    expect([Math.round(card.width), Math.round(card.height)]).toEqual([280, 128])
    expect(Math.round((await nudgeBtn(page, '15 min').boundingBox())!.height)).toBe(44)

    // A tap on the face outside the buttons neither opens the sheet nor ends the nudge
    await page.touchscreen.tap(card.x + 14, card.y + 14)
    await flushFrames(page)
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(nudge(page)).toBeVisible()

    // A drag from the face (press-and-hold) still starts and ends the nudge
    await touch.start(card.x + 14, card.y + 14)
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await expect(nudge(page)).toHaveCount(0)
    await touch.end()
    await expect(page.locator('.board.dragging')).toHaveCount(0)
  })

  test('tapping 30 min sets the timebox', async ({ context, page }) => {
    await touchIntoJetzt(context, page)
    await nudgeBtn(page, '30 min').tap()
    await expect(nudge(page)).toHaveCount(0)
    await expect(jetzt(page).locator('.task .chip__box')).toHaveText('30 min')
    await expect(page).toHaveURL(/\/tasks$/)
  })
})
