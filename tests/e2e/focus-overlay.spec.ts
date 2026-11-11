/**
 * #394: the focus overlay behind the Jetzt card ("the board steps back") and its setting.
 * Sequences, not single calls: on -> hidden -> on again, setting off -> on, sheet open -> closed.
 * The overlay's own state is read from `.focus-overlay.is-on` (CSS fades it; the class is the state machine's output).
 * The idle returns (2.5 s mouse, 4 s key, 8 s touch) run on the page clock (#543): `expectOn` jumps past them with
 * `elapse` instead of waiting, and the clock is never paused (touch specs; a frozen `Date.now()` is the #488 trap).
 */
import { test, expect, type Page } from '@playwright/test'
import { elapse, FOCUS_KEY_IDLE_MS, FOCUS_MOUSE_IDLE_MS, FOCUS_RETURN_DELAY_MS, FOCUS_TOUCH_IDLE_MS, installClock } from './helpers/clock'
import { SEED_TASKS, fillerTasks, seedLocalBoard, seedMixedBoard } from './helpers/seed'
import { hover, pickUp, showColumnPage } from './helpers/dnd'
import { callTasksStore } from './helpers/store'
import { appNav, goToPlace, openDayClose, openSettings } from './helpers/appNav'

const overlay = (page: Page) => page.getByTestId('focus-overlay')
const board = (page: Page) => page.locator('.board')
const isOn = async (page: Page) => (await overlay(page).getAttribute('class').catch(() => null))?.includes('is-on') ?? false
/** Runs the page clock `idleMs` ahead (default: past the longest mouse idle and the warm-up), then expects the overlay on. */
async function expectOn(page: Page, idleMs = FOCUS_MOUSE_IDLE_MS + 500) {
  if (idleMs > 0) await elapse(page, idleMs)
  await expect.poll(() => isOn(page)).toBe(true)
}
const expectHidden = (page: Page) => expect.poll(() => isOn(page)).toBe(false)
const expectAbsent = (page: Page) => expect(overlay(page)).toHaveCount(0)

/** A real mouse move of at least 3px, also from a pointer that has not moved yet */
async function wiggle(page: Page, x = 300, y = 400) {
  await page.mouse.move(x, y)
  await page.mouse.move(x + 40, y + 20, { steps: 4 })
}

async function openBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
}

// Every describe runs on the page clock; installed before the describe's seed
test.beforeEach(async ({ context }) => {
  await installClock(context)
})

test.describe('desktop, mouse', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { focus: true })
  })

  test('with a task in Jetzt the overlay is on, covers the board, never takes a pointer and is aria-hidden', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await expect(overlay(page)).toHaveAttribute('aria-hidden', 'true')
    await expect(overlay(page)).toHaveCSS('pointer-events', 'none')
    await expect(board(page)).toHaveAttribute('data-focus', '')
    // Desktop: the overlay is fixed over the whole viewport, below the app bar (#694); only the Jetzt column sits above it
    const [o, vp] = await Promise.all([
      overlay(page).boundingBox(),
      page.evaluate(() => ({ w: innerWidth, h: innerHeight })),
    ])
    expect(Math.round(o!.x)).toBe(0)
    expect(Math.round(o!.y)).toBe(0)
    expect(Math.round(o!.width)).toBe(vp.w)
    expect(Math.round(o!.height)).toBe(vp.h)
    await expect(overlay(page)).toHaveCSS('position', 'fixed')
    await expect(overlay(page)).toHaveCSS('z-index', '1000')
    await expect(page.locator('#column-progress')).toHaveCSS('z-index', '1100')
    // The board stays below the app bar (40), so the bar stays above the overlay; the Erledigt footer is not lifted
    await expect(board(page)).toHaveCSS('z-index', 'auto')
    await expect(appNav(page)).toHaveCSS('z-index', '40')
    await expect(page.getByTestId('focus-overlay-bar')).toHaveCount(0)
    await expect(page.getByTestId('day-close-cta')).toBeVisible()
    await expect(page.locator('.column-footer')).toHaveCSS('z-index', '400')
    // Wartet does not form a stacking context above the overlay, and no other column does either
    for (const id of ['column-open', 'column-waiting', 'column-done']) {
      expect(Number((await page.locator(`#${id}`).evaluate(el => getComputedStyle(el).zIndex)).replace('auto', '0'))).toBeLessThan(1000)
    }
  })

  test('the day-close button is dimmed while the overlay is on and the app bar is not; both are plain again once it is hidden (A -> B -> A, #694)', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    const chrome = {
      bar: appNav(page).locator('.app-nav-pill'),
      cta: page.getByTestId('day-close-cta'),
    }
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '1')
    const snap = async () => ({
      bar: await chrome.bar.screenshot(),
      cta: await chrome.cta.screenshot(),
    })
    // The glass pill blurs what lies behind it, so its pixels change with the board; what must hold is the stacking:
    // at the pill's centre the app bar is painted above the overlay
    const barAboveOverlay = () => chrome.bar.first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const bar = stack.findIndex(n => n.closest('.app-nav'))
      const ov = stack.findIndex(n => n.closest('[data-testid="focus-overlay"]'))
      return bar !== -1 && (ov === -1 || bar < ov)
    })
    expect(await barAboveOverlay()).toBe(true)
    const lit = await snap()
    await wiggle(page, 640, 300)
    await expectHidden(page)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '0')
    const plain = await snap()
        expect(lit.cta.equals(plain.cta)).toBe(false)
    await expectOn(page)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '1')
    const again = await snap()
    expect(again.cta.equals(plain.cta)).toBe(false)
  })

  test('with the page scrolled the app bar stays on top and undimmed, overlay on or hidden (#503, #694)', async ({ page }) => {
    // A tall Offen column makes the page scroll; the later init script replaces the describe's seed
    await seedLocalBoard(page.context(), [...SEED_TASKS, ...fillerTasks(25)], {}, undefined, { focus: true })
    await openBoard(page)
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    await expectOn(page)
    const pill = appNav(page).locator('.app-nav-pill').first()
    const onTop = () => pill.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!hit && (el === hit || el.contains(hit) || !!hit.closest('.app-nav'))
    })
    await expect.poll(onTop).toBe(true)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '1')
    await wiggle(page, 640, 300)
    await expectHidden(page)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '0')
    await expect.poll(onTop).toBe(true)
  })

  test('the Jetzt card has the raised shadow only while the overlay is visible (#503)', async ({ page }) => {
    const shadow = () => page.locator('#column-progress .task[data-current]').evaluate(el => getComputedStyle(el).boxShadow)
    await openBoard(page)
    const regular = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.boxShadow = 'var(--shadow-task)'
      document.body.append(probe)
      const v = getComputedStyle(probe).boxShadow
      probe.remove()
      return v
    })
    await expectOn(page)
    await expect.poll(shadow).toContain('38px')
    // Overlay hidden by a mouse move: the card is a regular card (focus mode is still on)
    await wiggle(page)
    await expectHidden(page)
    await expect(board(page)).toHaveAttribute('data-focus', '')
    await expect(board(page)).not.toHaveAttribute('data-focus-lit', /.*/)
    await expect.poll(shadow).toBe(regular)
    // ...and lifted again with the overlay
    await expectOn(page)
    await expect(board(page)).toHaveAttribute('data-focus-lit', '')
    await expect.poll(shadow).toContain('38px')
  })

  test('back from another page it waits the return delay, a cold load shows it at once (kd#133)', async ({ context, page }) => {
    // Recorded on the page clock, so nothing races the 900 ms timer: when the overlay element arrived and when it lit
    await context.addInitScript(() => {
      const log: { kind: 'mounted' | 'on'; t: number }[] = []
      ;(window as unknown as { __focusLog: typeof log }).__focusLog = log
      let had = false
      let lit = false
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="focus-overlay"]')
        if (!!el !== had) {
          had = !!el
          lit = false
          if (had) log.push({ kind: 'mounted', t: Date.now() })
        }
        const on = !!el?.classList.contains('is-on')
        if (on && !lit) log.push({ kind: 'on', t: Date.now() })
        lit = on
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    })
    /** Page-clock time between the overlay's last mount and its first lighting after it */
    const mountToLit = () => page.evaluate(() => {
      const log = (window as unknown as { __focusLog: { kind: string; t: number }[] }).__focusLog
      const mounted = log.findLastIndex(e => e.kind === 'mounted')
      const on = log.findIndex((e, i) => i > mounted && e.kind === 'on')
      return mounted === -1 || on === -1 ? null : log[on]!.t - log[mounted]!.t
    })

    await openBoard(page)
    await expectOn(page)
    expect(await mountToLit()).toBeLessThan(FOCUS_RETURN_DELAY_MS / 2)

    await goToPlace(page, 'Statistik')
    await expectAbsent(page)
    // The pointer rests on the bar after the click, so no mouse move hides the overlay: only the delay holds it back
    await goToPlace(page, 'Heute')
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
    await expectOn(page, FOCUS_RETURN_DELAY_MS)
    // The timer starts in the board's setup, a moment before the element is in the DOM
    expect(await mountToLit()).toBeGreaterThan(FOCUS_RETURN_DELAY_MS - 250)
  })

  test('a mouse move hides it, rest brings it back, and it can go again (A -> B -> A -> B)', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await wiggle(page)
    await expectHidden(page)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('opacity', '0')
    await expectOn(page)
    await wiggle(page, 500, 300)
    await expectHidden(page)
  })

  test('a key press hides it; a lone modifier does not; it comes back', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await page.keyboard.press('Shift')
    expect(await isOn(page)).toBe(true)
    await page.keyboard.press('a')
    await expectHidden(page)
    await expectOn(page, FOCUS_KEY_IDLE_MS + 500)
  })

  test('window blur shows it at once; regaining focus acts like a mouse move', async ({ page }) => {
    await openBoard(page)
    await wiggle(page)
    await expectHidden(page)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expectOn(page, 0) // at once, no idle wait
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expectHidden(page)
    await expectOn(page)
  })

  test('Tab to a covered card hides it and the card shows its normal focus ring', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await page.keyboard.press('Tab')
    await expectHidden(page)
    const waiting = page.locator('#column-waiting .task-wrapper').first()
    await waiting.focus()
    await expect(waiting.locator('.task')).toHaveCSS('outline-width', '3px')
  })

  test('prefers-reduced-motion: the fades are 120 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBoard(page)
    await expectOn(page)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('transition-duration', '0.12s')
  })

  test('a card leaving Jetzt takes the overlay and the layer rules with it', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await pickUp(page, page.locator('#column-progress .task-wrapper').first())
    await expectAbsent(page)
    await hover(page, page.locator('#column-done-list'))
    await page.mouse.up()
    await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
    await expectAbsent(page)
    await expect(board(page)).not.toHaveAttribute('data-focus', /.*/)
  })

  test('a card leaving Jetzt without a drag fades the overlay out before it goes; the layer rules go at once', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await callTasksStore(page, { action: 'updateTask', args: ['seed-progress-1', { status: 2 }] })
    await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
    // Still mounted, fading (not snapped off), and no longer lifting the Jetzt column
    await expect(overlay(page)).toHaveClass(/is-leaving/)
    await expect(overlay(page)).not.toHaveClass(/is-on/)
    await expect(overlay(page).locator('.focus-overlay__tint')).toHaveCSS('transition-duration', '0.6s')
    await expect(board(page)).not.toHaveAttribute('data-focus', /.*/)
    await expectAbsent(page)
  })

  test('a drag turns it off and it returns after the drop', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await pickUp(page, page.locator('#column-open .task-wrapper').first())
    await expectAbsent(page)
    await hover(page, page.locator('#column-waiting-list'))
    await page.mouse.up()
    await expect(page.locator('.board.dragging')).toHaveCount(0)
    await expectOn(page)
  })

  test('the task sheet turns it off and closing it brings it back', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await page.locator('#column-open .task-wrapper').first().click()
    await expect(page).toHaveURL(/\/tasks\/seed-open-/)
    await expectAbsent(page)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expectOn(page)
  })

  test('the in-card new-task form turns it off and cancelling it brings it back (kd#56)', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await page.locator('#column-open .add-task-button').click()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await expectAbsent(page)
    // Time passing alone does not bring it back while the form is open
    await elapse(page, FOCUS_MOUSE_IDLE_MS + 500)
    await expectAbsent(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-card-flow')).toHaveCount(0)
    await expectOn(page)
  })

  test('the day-close dialog and the command palette each turn it off, with no layer left behind', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)

    await openDayClose(page)
    await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeVisible()
    await expectAbsent(page)
    await expect(board(page)).not.toHaveAttribute('data-focus', /.*/)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeHidden()
    await expectOn(page)

    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible()
    await expectAbsent(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeHidden()
    await expectOn(page)
  })
})

test.describe('no overlay', () => {
  test('without a task in Jetzt there is no overlay and no layer change', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(t => t.status !== 1), {}, undefined, { focus: true })
    await page.goto('/tasks')
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible()
    await expectAbsent(page)
    await expect(board(page)).not.toHaveAttribute('data-focus', /.*/)
    await expect(page.locator('#column-progress')).toHaveCSS('z-index', '1')
  })

  test('a card arriving in Jetzt warms the overlay up after a beat', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(t => t.status !== 1), {}, undefined, { focus: true })
    await page.goto('/tasks')
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible()
    await expectAbsent(page)
    await pickUp(page, page.locator('#column-open .task-wrapper').first())
    await hover(page, page.locator('#column-progress-list'))
    await page.mouse.up()
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
    await expect(overlay(page)).toHaveCount(1)
    await expectOn(page)
  })

  test('with the setting off: no element, no data-focus, the plain z-index rules, the status look of the card', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { focus: false })
    await openBoard(page)
    await wiggle(page, 20, 700) // off every card: a hovered card lifts
    await expectAbsent(page)
    await expect(board(page)).not.toHaveAttribute('data-focus', /.*/)
    await expect(page.locator('#column-progress')).toHaveCSS('z-index', '1')
    await expect(page.locator('.column-footer')).toHaveCSS('z-index', '400')
    // The card keeps the in-progress status look (`.task-progress`, background) but has the regular card shadow; the lamp-lit lift is the overlay's alone (#503)
    const [now, status] = await Promise.all([
      page.locator('#column-progress .task[data-current]').evaluate(el => getComputedStyle(el).boxShadow),
      page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.boxShadow = 'var(--shadow-task)'
        document.body.append(probe)
        const shadow = getComputedStyle(probe).boxShadow
        probe.remove()
        return shadow
      }),
    ])
    expect(now).toBe(status)
    expect(now).not.toContain('38px')
  })

  test('a board stored before the setting existed has it on', async ({ context, page }) => {
    await seedLocalBoard(context)
    await context.addInitScript(() => localStorage.removeItem('settings-store'))
    await openBoard(page)
    await expectOn(page)
  })
})

test.describe('setting on /settings', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { focus: true, once: true })
  })

  test('the switch takes effect on the board without a reload and survives one (on -> off -> on)', async ({ page }) => {
    await openBoard(page)
    await expectOn(page)
    await openSettings(page)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeAttached() // sr-only: the app bar names the page (#670)
    await expect(page.getByText('Fokus und Verbindungen')).toHaveCount(0)

    const toggle = page.getByTestId('focus-switch')
    await expect(toggle).toBeChecked()
    await expect(toggle).toHaveAttribute('aria-describedby', 'focus-help')
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').focusEnabled)).toBe(false)

    await goToPlace(page, 'Heute')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
    await expectAbsent(page)

    await page.reload()
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
    await expectAbsent(page)

    await page.goto('/settings')
    await expect(page.getByTestId('focus-switch')).not.toBeChecked()
    await page.getByTestId('focus-switch').click()
    await expect(page.getByTestId('focus-switch')).toBeChecked()
    await goToPlace(page, 'Heute')
    await expectOn(page)
  })

  test('/settings/sources redirects to /settings on a cold load and on in-app navigation', async ({ page }) => {
    await page.goto('/settings/sources')
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(page.getByTestId('sources-connected')).toBeVisible()

    await page.goto('/tasks')
    // `goto` resolves on the load event, before the client-only app has mounted its router. A popstate dispatched
    // that early has no listener and is lost (#427), so wait until the board has rendered.
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible()
    // In-app navigation without a link to the old path: the router listens to popstate, like a back/forward step to it
    await page.evaluate(() => {
      history.pushState({}, '', '/settings/sources')
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(page.getByTestId('sources-connected')).toBeVisible()
  })

  test('the Fokus option is the Board tab, the sources are one tab over (#691)', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('focus-switch')).toBeVisible()
    await expect(page.getByTestId('sources-connected')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Aufgabenquellen' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Deine Verbindungen' })).toBeVisible()
  })
})

test.describe('phone and tablet, touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { focus: true })
    await page.goto('/tasks')
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible()
    await showColumnPage(page, 1)
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
  })

  test('the first tap outside hides it and is swallowed, the next one works (A -> B -> A)', async ({ page }) => {
    await expectOn(page)
    const waiting = page.locator('#column-waiting .task-wrapper').first()
    const box = (await waiting.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expectHidden(page)
    // swallowed: nothing opened under the finger
    await elapse(page, 600) // past the swallow window
    await expect(page).toHaveURL(/\/tasks$/)
    // the next tap works normally
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page).toHaveURL(/\/tasks\/seed-waiting-1/)
  })

  test('a tap on the Now card, the Jetzt header or the app bar keeps the overlay', async ({ page }) => {
    await expectOn(page)
    await showColumnPage(page, 1)
    expect(await isOn(page)).toBe(true)
    const header = page.locator('#column-progress').getByRole('heading').first()
    await header.tap()
    expect(await isOn(page)).toBe(true)
    // the bar is lit and its first tap is not swallowed (#470): Heute is the current place, so nothing navigates
    await appNav(page).getByRole('link', { name: 'Heute' }).tap()
    expect(await isOn(page)).toBe(true)
    const card = (await page.locator('#column-progress .task[data-current]').boundingBox())!
    await page.touchscreen.tap(card.x + card.width / 2, card.y + card.height / 2)
    // the card tap acts normally (opens the sheet), which turns the overlay off by itself
    await expect(page).toHaveURL(/\/tasks\/seed-progress-1/)
  })

  test('the nav pill stays above the overlay and the day-close button is dimmed with the rest (#503)', async ({ page }) => {
    await expectOn(page)
    await expect(board(page)).toHaveCSS('z-index', 'auto')
    await expect(appNav(page)).toHaveCSS('z-index', '40')
    await expect(overlay(page)).toHaveCSS('position', 'absolute')
    const pill = (await appNav(page).locator('.app-nav-pill').boundingBox())!
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-app-nav]') !== null, { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 })
    expect(top).toBe(true)
    await expect(page.locator('.column-footer')).toHaveCSS('z-index', '400')
  })

  test('it returns after 8 s without a tap', async ({ page }) => {
    await expectOn(page)
    const open = (await page.locator('#column-waiting .task-wrapper').first().boundingBox())!
    await page.touchscreen.tap(open.x + open.width / 2, open.y + open.height / 2)
    await expectHidden(page)
    await elapse(page, 3000)
    expect(await isOn(page)).toBe(false) // 3 s into the 8 s idle: still hidden
    await expectOn(page, FOCUS_TOUCH_IDLE_MS)
  })

  test('swiping to Offen or Erledigt removes it; coming back shows it after a beat', async ({ page }) => {
    await expectOn(page)
    await showColumnPage(page, 0)
    await expectAbsent(page)
    await showColumnPage(page, 2)
    await expectAbsent(page)
    await showColumnPage(page, 1)
    await expectOn(page)
  })
})

test.describe('mixed board', () => {
  test('the overlay works with Local and Notion tasks side by side', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { focus: true })
    await page.goto('/tasks')
    await expect(page.locator('#column-progress .task[data-current]')).toBeVisible()
    await expectOn(page)
  })
})
