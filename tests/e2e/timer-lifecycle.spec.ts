import { test, expect, type Page } from '@playwright/test'
import { elapse, installClock } from './helpers/clock'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { goToPlace, openSettings } from './helpers/appNav'

/**
 * #352: a task in Jetzt is timed by one app-level timer for exactly as long as it is in Jetzt, whichever page is
 * open. The Jetzt task is `seed-progress-1` ("Review schreiben"). Stored state is read from `tasks-store`
 * (`timeSpentSeconds`, `timerId`), always through `expect.poll`. A counter in an init script tracks the live
 * one-second intervals, so "exactly one interval" is observable.
 */

const JETZT_ID = 'seed-progress-1'
const JETZT_TITLE = 'Review schreiben'

type StoredTask = { id: string; timeSpentSeconds: number; timerId: number | null; status: number }

const storedTask = (page: Page, id = JETZT_ID) =>
  page.evaluate((taskId) => {
    const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: StoredTask[] }
    return (raw.tasks ?? []).find((task) => task.id === taskId) ?? null
  }, id) as Promise<StoredTask | null>

const spent = async (page: Page, id = JETZT_ID) => (await storedTask(page, id))?.timeSpentSeconds ?? -1
const live1sIntervals = (page: Page) => page.evaluate(() => (window as unknown as { __live1s: Set<number> }).__live1s.size)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()

async function moveTo(page: Page, title: string, column: 'Jetzt' | 'Warten' | 'Erledigt') {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: column, exact: true }).click()
}

/** Seconds counted in `ms` of page-clock time (#543): the delta of the stored time between two reads. */
async function countedOver(page: Page, ms: number): Promise<number> {
  const before = await spent(page)
  await elapse(page, ms)
  return (await spent(page)) - before
}

test.describe('Jetzt timer lifecycle (#352)', () => {
  test.beforeEach(async ({ context }) => {
    // The fake clock goes first: the wrapper below then wraps the clock's setInterval, not the other way round
    await installClock(context)
    // Wrap the interval functions before any page script runs; counts live 1 s intervals and logs every clearInterval
    await context.addInitScript(() => {
      const win = window as unknown as { __live1s: Set<number>; __cleared: Array<{ handle: number; ms: number | null }>; __ms: Map<number, number> }
      win.__live1s = new Set()
      win.__cleared = []
      win.__ms = new Map()
      const set = window.setInterval.bind(window)
      const clear = window.clearInterval.bind(window)
      window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
        const handle = set(handler, ms, ...args)
        win.__ms.set(handle, ms ?? 0)
        if (ms === 1000) win.__live1s.add(handle)
        return handle
      }) as typeof window.setInterval
      window.clearInterval = ((handle?: number) => {
        if (handle !== undefined) {
          win.__cleared.push({ handle, ms: win.__ms.get(handle) ?? null })
          win.__live1s.delete(handle)
        }
        clear(handle)
      }) as typeof window.clearInterval
    })
    await seedLocalBoard(
      context,
      [...SEED_TASKS.map((task) => (task.id === JETZT_ID ? { ...task, timeSpentSeconds: 100 } : task))],
      {},
      undefined,
      { once: true },
    )
  })

  test('board -> Settings -> board: time counts throughout, one interval after the remount, no double speed', async ({ page }) => {
    await page.goto('/tasks')
    await expect(card(page, JETZT_TITLE)).toBeVisible()
    await expect.poll(() => live1sIntervals(page)).toBe(1)

    await openSettings(page)
    await expect(page).toHaveURL(/\/settings$/)
    expect(await countedOver(page, 3000)).toBeGreaterThanOrEqual(2)
    expect(await live1sIntervals(page)).toBe(1) // the board is gone, the timer stays

    await goToPlace(page, 'Heute')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(card(page, JETZT_TITLE)).toBeVisible()
    const delta = await countedOver(page, 3000)
    expect(delta).toBeGreaterThanOrEqual(2)
    expect(delta).toBeLessThanOrEqual(4)
    expect(await live1sIntervals(page)).toBe(1)
    await expect.poll(async () => (await storedTask(page))?.timerId).not.toBeNull()
  })

  test('work session (#600): opens with the timer, grows by the minute, closes when the task leaves Jetzt', async ({ page }) => {
    const sessions = () => page.evaluate(() => (JSON.parse(localStorage.getItem('taskStatistics') ?? '{}') as { workSessions?: Array<{ start: number; end: number }> }).workSessions ?? [])
    await page.goto('/tasks')
    await expect(card(page, JETZT_TITLE)).toBeVisible()
    await expect.poll(async () => (await sessions()).length).toBe(1)

    await elapse(page, 130_000)
    await expect.poll(async () => { const [session] = await sessions(); return session ? session.end - session.start : 0 }).toBeGreaterThanOrEqual(120_000)

    await moveTo(page, JETZT_TITLE, 'Warten')
    await expect.poll(() => live1sIntervals(page)).toBe(0)
    const closed = (await sessions())[0]!
    await elapse(page, 130_000)
    expect(await sessions()).toEqual([closed])
  })

  test('client-side to the statistics page counts there too', async ({ page }) => {
    await page.goto('/tasks')
    await expect(card(page, JETZT_TITLE)).toBeVisible()
    await page.evaluate(() => {
      const app = (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp()
      return app.$router.push('/statistics')
    })
    await expect(page).toHaveURL(/\/statistics$/)
    expect(await countedOver(page, 3000)).toBeGreaterThanOrEqual(2)
    expect(await live1sIntervals(page)).toBe(1)
  })

  test('reload on a settings page: counts again from the saved time, the closed time is not added', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    await expect(page).toHaveURL(/\/settings$/)
    await expect.poll(() => spent(page)).toBeGreaterThan(100)

    const before = await spent(page)
    const reloadedAt = Date.now()
    await page.reload()
    await expect(page).toHaveURL(/\/settings$/)
    // The board never mounted in this load; the driver still counts
    await elapse(page, 2000)
    await expect.poll(() => spent(page)).toBeGreaterThan(before)
    // two page-clock seconds counted, plus whatever real time passed (the clock ticks by itself too)
    expect(await spent(page)).toBeLessThanOrEqual(before + 2 + Math.ceil((Date.now() - reloadedAt) / 1000) + 1)
    expect(await live1sIntervals(page)).toBe(1)
    expect((await storedTask(page))?.timerId).not.toBeNull()
  })

  test('Jetzt -> Wartet stops at once; Wartet -> Jetzt resumes from the kept time with one interval', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => live1sIntervals(page)).toBe(1)

    await moveTo(page, JETZT_TITLE, 'Warten')
    await expect.poll(async () => (await storedTask(page))?.status).toBe(2)
    await expect.poll(async () => (await storedTask(page))?.timerId).toBeNull()
    expect(await live1sIntervals(page)).toBe(0)
    const kept = await spent(page)
    expect(await countedOver(page, 2500)).toBe(0)

    await moveTo(page, JETZT_TITLE, 'Jetzt')
    await expect.poll(async () => (await storedTask(page))?.status).toBe(1)
    await elapse(page, 1000) // the first tick of the resumed interval
    await expect.poll(() => spent(page)).toBeGreaterThan(kept)
    expect(await live1sIntervals(page)).toBe(1)
    const delta = await countedOver(page, 3000)
    expect(delta).toBeGreaterThanOrEqual(2)
    expect(delta).toBeLessThanOrEqual(4)
  })

  test('Jetzt -> Erledigt -> undo toast -> Jetzt resumes from the kept time with one interval', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => live1sIntervals(page)).toBe(1)

    await moveTo(page, JETZT_TITLE, 'Erledigt')
    await expect.poll(async () => (await storedTask(page))?.status).toBe(3)
    await expect.poll(async () => (await storedTask(page))?.timerId).toBeNull()
    expect(await live1sIntervals(page)).toBe(0)
    const kept = await spent(page)
    expect(await countedOver(page, 2500)).toBe(0)

    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect.poll(async () => (await storedTask(page))?.status).toBe(1)
    await elapse(page, 1000) // the first tick of the resumed interval
    await expect.poll(() => spent(page)).toBeGreaterThan(kept)
    expect(await live1sIntervals(page)).toBe(1)
  })

  test('a timer of a task that leaves Jetzt while the board is not mounted stops too (a sync moves it away)', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    await expect(page).toHaveURL(/\/settings$/)
    await page.evaluate((id) => {
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, Record<string, (...a: unknown[]) => unknown>> } } }).useNuxtApp()
      app.$pinia._s.get('tasks')!.updateTask!(id, { status: 2 })
    }, JETZT_ID)
    await expect.poll(async () => (await storedTask(page))?.timerId).toBeNull()
    expect(await live1sIntervals(page)).toBe(0)
    expect(await countedOver(page, 2500)).toBe(0)
  })

  test('stale timerIds from a previous load never reach clearInterval and the page intervals keep running', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => live1sIntervals(page)).toBe(1)

    // Every interval handle of this load that is not a task timer (app sync, board refresh, ...) becomes a stale
    // persisted timerId of some other task, as a store saved by the old code would carry it.
    const stale = await page.evaluate(() => {
      const win = window as unknown as { __ms: Map<number, number> }
      return [...win.__ms.entries()].filter(([, ms]) => ms !== 1000).map(([handle]) => handle)
    })
    expect(stale.length).toBeGreaterThan(0)
    await page.evaluate((handles) => {
      const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks: Array<{ id: string; timerId: number | null; status: number }> }
      const others = raw.tasks.filter((task) => task.status !== 1)
      handles.forEach((handle, index) => { if (others[index]) others[index].timerId = handle })
      localStorage.setItem('tasks-store', JSON.stringify(raw))
    }, stale)

    // Reload on purpose (#512): the stale ids come from the previous page load, the test is what the next load does with them
    await page.reload()
    await expect(card(page, JETZT_TITLE)).toBeVisible()
    await expect.poll(() => live1sIntervals(page)).toBe(1)

    // No stale timerId survives, and nothing cleared an interval that is not a 1 s task timer while on the board
    await expect.poll(() => page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks: Array<{ status: number; timerId: number | null }> }
      return raw.tasks.filter((task) => task.status !== 1 && task.timerId !== null).length
    })).toBe(0)
    const cleared = await page.evaluate(() => (window as unknown as { __cleared: Array<{ handle: number; ms: number | null }> }).__cleared)
    expect(cleared.filter((entry) => entry.ms !== null && entry.ms !== 1000)).toEqual([])
    expect(await countedOver(page, 2500)).toBeGreaterThanOrEqual(2)
  })
})
