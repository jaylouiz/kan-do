import type { BrowserContext, Page } from '@playwright/test'

/**
 * Pinned wall clock for specs whose data is bucketed by calendar day (#449): trash "Heute / Gestern / Früher", the
 * Erledigt column's "Gestern erledigt" note, the dayclose seed. A seed built from `Date.now() - n minutes` lands on
 * another day when the suite runs just after midnight, so those specs pin the browser clock and seed against the same instant.
 *
 * Default: 2026-06-15 12:00 local. `E2E_PINNED_TIME=HH:MM` moves it within that day (proof runs at 00:01, 12:00 and 23:59).
 */
export function pinnedNow(): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(process.env.E2E_PINNED_TIME ?? '12:00')
  if (!match) throw new Error(`E2E_PINNED_TIME must be HH:MM, got "${process.env.E2E_PINNED_TIME}"`)
  return new Date(2026, 5, 15, Number(match[1]), Number(match[2]), 0)
}

/**
 * Set the page clock's wall time to `pinnedNow()` in every page of the context; it keeps running from there, timers too.
 * Call before `goto`. Not `clock.setFixedTime` (#488): a frozen `Date.now()` makes Vue 3's event invoker drop every
 * listener after the first on an event's path, because it skips an event whose `_vts` (stamped with `Date.now()` at
 * dispatch) is `<=` the invoker's `attached` (`Date.now()` when the listener was bound), and with a frozen clock those are
 * equal. On the phone board a touch on a card then never reached the swipe handler on `.board-container` (the first
 * Vue listener, the card's own, ran; the board's did not). The price of a ticking clock is drift: a spec has as many
 * seconds from the pinned instant as it runs, so `E2E_PINNED_TIME=23:59` leaves 60 s before the day changes.
 */
export async function pinClock(target: Page | BrowserContext): Promise<Date> {
  const now = pinnedNow()
  await target.clock.setSystemTime(now)
  return now
}

/** Local midnight at the start of `now`'s day, in ms. */
export function startOfDay(now: Date): number {
  return new Date(now).setHours(0, 0, 0, 0)
}

/**
 * App timer lengths for specs that drive the page clock (#543). E2E files cannot import the composables (they pull in
 * Nuxt), so `tests/config/e2e-timer-constants.test.ts` pins every value here to its source constant.
 */
/** `MOVE_UNDO_WINDOW_MS`, `DELETE_UNDO_WINDOW_MS` and `REMOVE_UNDO_WINDOW_MS`: all three undo windows. */
export const UNDO_WINDOW_MS = 5000
/** `GAP_CLOSE_MS`: how long a gap glides shut after its window; assert the layout only after it. */
export const GAP_CLOSE_MS = 280
/** `UNDO_RETURN_MS`: the grow-back of a card that came back from an undo. */
export const UNDO_RETURN_MS = 180
/** `TOAST_CLOSE_POLL_MS`: a toast window re-checks this often after its duration whether the toast has closed. */
export const TOAST_CLOSE_POLL_MS = 1000
/** `MOUSE_IDLE_MS`, `KEY_IDLE_MS`, `TOUCH_IDLE_MS`, `RETURN_DELAY_MS`: when the focus overlay returns (#394). */
export const FOCUS_MOUSE_IDLE_MS = 2500
export const FOCUS_KEY_IDLE_MS = 4000
export const FOCUS_TOUCH_IDLE_MS = 8000
export const FOCUS_RETURN_DELAY_MS = 900
/** `TIMEBOX_NUDGE_MS`: the timebox nudge's countdown, a CSS animation the page clock does not reach. */
export const NUDGE_COUNTDOWN_MS = 8000
/** What `elapseWindow` runs after the jump: the close poll of a toast window, the closing glide, and a margin. */
export const AFTER_WINDOW_MS = TOAST_CLOSE_POLL_MS + GAP_CLOSE_MS + 700

/**
 * Put the page on Playwright's fake clock without freezing it (#543): timers (undo windows, the focus overlay's return,
 * the nudge countdown, toasts) still fire in real time, and `elapse` jumps them forward. Call before the seed and before
 * `goto`. Not `pauseAt`: a paused clock freezes `Date.now()` (the #488 trap, Vue drops listeners) and `requestAnimationFrame`
 * (Vue transitions stall), so a spec that needs a paused clock says why. Specs that bucket data by day pass
 * `{ pinned: true }`: the clock then starts at `pinnedNow()` like `pinClock`, and keeps ticking from there.
 */
export async function installClock(target: Page | BrowserContext, options: { pinned?: boolean } = {}): Promise<void> {
  await target.clock.install(options.pinned ? { time: pinnedNow() } : undefined)
}

/**
 * Run the page's timers forward by `ms` (`clock.runFor`: every timer due in the span fires, in order). Replaces waiting
 * out an app timer in real time. A window that can only be asserted open "for a while" gets a short `ms` (the clock also
 * ticks by itself).
 */
export async function elapse(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms)
}

/**
 * Lets requests that timers fired a moment ago leave the page and reach the test's listeners, before it counts that
 * none did: two frames, then 0.5 s of real time (`waitForLoadState('networkidle')` would not do: it resolves at once
 * when the document already was idle). A negative check with a positive control next to it (the same flow with the
 * call expected); not for outlasting an app timer.
 */
export async function settleRequests(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(500)
}

/**
 * Settle every open undo window: jump past `UNDO_WINDOW_MS`, then run the timers they set on closing (the toast close
 * poll, the gap's closing glide).
 */
export async function elapseWindow(page: Page): Promise<void> {
  await page.clock.fastForward(UNDO_WINDOW_MS)
  await page.clock.runFor(AFTER_WINDOW_MS)
}
