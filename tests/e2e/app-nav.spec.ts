import { test, expect, type Locator, type Page } from '@playwright/test'
import { SEED_TASKS, seedLocalBoard, seedMixedBoard } from './helpers/seed'
import { appNav, closeMore, goToPlace, moreButton, morePanel, openMore, openSettings, openTrash, thirdItem, waitForNavIdle } from './helpers/appNav'

/**
 * Issue #470 (ADR 017): the global app bar and its Mehr panel on every page, at 1280 (top) and 390 (floating at the
 * bottom). The binding rule is tested as sequences: the selected state follows the route only, an open panel is an
 * overlay and never replaces it.
 */
const heute = (page: Page) => page.getByTestId('app-nav-place-board')
const statistik = (page: Page) => page.getByTestId('app-nav-place-statistics')

/** The one control that carries aria-current="page", by its test id (or null). */
async function current(page: Page): Promise<string | null> {
  const ids = await appNav(page).locator('[aria-current="page"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')))
  expect(ids.length).toBeLessThanOrEqual(1) // one current item per set
  return ids[0] ?? null
}

const indicator = (page: Page) => appNav(page).locator('.app-nav-indicator')

/** The shared indicator (the raised chip) sits on `target`: same left edge and width, within a pixel and a half. */
async function expectIndicatorOn(page: Page, target: Locator) {
  await expect.poll(async () => {
    const [chip, box] = await Promise.all([indicator(page).boundingBox(), target.boundingBox()])
    if (!chip || !box) return 'missing'
    return Math.max(Math.abs(chip.x - box.x), Math.abs(chip.width - box.width)) <= 1.5 ? 'on target' : `chip ${chip.x}/${chip.width} vs ${box.x}/${box.width}`
  }).toBe('on target')
}

const VIEWPORTS = [
  { label: '1280', size: { width: 1280, height: 800 } },
  { label: '390', size: { width: 390, height: 844 } },
] as const

for (const { label, size } of VIEWPORTS) {
  test.describe(`App bar at ${label}`, () => {
    test.use({ viewport: size })

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
    })

    const places: Array<[string, string | null]> = [
      ['/tasks', 'app-nav-place-board'],
      ['/tasks/add', 'app-nav-place-board'],
      ['/tasks/seed-open-1', 'app-nav-place-board'],
      ['/statistics', 'app-nav-place-statistics'],
      ['/trash', 'app-nav-place-more'],
      ['/settings', 'app-nav-place-more'],
      ['/settings/topics', 'app-nav-place-more'],
    ]

    // A short sub-page fills the viewport below the bar and no more: the bar's own height must not add a document
    // scroll (pages with real content, /statistics and /settings, scroll on their own and say nothing about it)
    for (const path of ['/trash', '/settings/topics']) {
      test(`${path} does not scroll the document by the bar height`, async ({ page }) => {
        await page.goto(path)
        await expect(appNav(page)).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
      })
    }

    for (const [path, expected] of places) {
      test(`direct load of ${path} selects exactly ${expected}`, async ({ page }) => {
        await page.goto(path)
        await expect(appNav(page)).toBeVisible()
        await expect.poll(() => current(page)).toBe(expected)
      })
    }

    test('geometry: pills at the top on desktop, floating at the bottom on a phone, 44px hit areas on a phone', async ({ page }) => {
      await page.goto('/tasks')
      const group = (await appNav(page).locator('.app-nav-group').boundingBox())!
      const pill = (await appNav(page).locator('.app-nav-pill').boundingBox())!
      const more = (await moreButton(page).boundingBox())!
      expect(Math.abs(group.x + group.width / 2 - size.width / 2)).toBeLessThanOrEqual(2) // centred
      if (size.width >= 768) {
        expect(pill.y).toBeLessThan(size.height / 4)
        expect(pill.height).toBeCloseTo(36, 0)
        expect(more.width).toBeCloseTo(36, 0)
      } else {
        expect(pill.y).toBeGreaterThan(size.height * 0.8)
        for (const control of [heute(page), statistik(page), moreButton(page)]) {
          const box = (await control.boundingBox())!
          expect(box.width).toBeGreaterThanOrEqual(44)
          expect(box.height).toBeGreaterThanOrEqual(44)
        }
      }
    })

    test('binding rule: Heute stays selected while the panel is open; ⋯ is only open, never selected', async ({ page }) => {
      await page.goto('/tasks')
      await expect.poll(() => current(page)).toBe('app-nav-place-board')

      await openMore(page)
      await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'true')
      await expect(moreButton(page)).toHaveAttribute('aria-haspopup', 'dialog')
      expect(await current(page)).toBe('app-nav-place-board') // still Heute
      await expect(moreButton(page)).not.toHaveAttribute('aria-current', 'page')
      await expect(heute(page)).toHaveClass(/is-selected/)
      await expect(moreButton(page)).toHaveClass(/is-open/)
      await expect(moreButton(page)).not.toHaveClass(/is-selected/)

      await closeMore(page)
      await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'false')
      expect(await current(page)).toBe('app-nav-place-board')
    })

    // #583: the page behind ⋯ is the pill's third segment and carries the selection; ⋯ is never selected
    test('binding rule on Papierkorb: the third segment is selected, ⋯ is only open, neither place is selected', async ({ page }) => {
      await page.goto('/trash')
      await expect.poll(() => current(page)).toBe('app-nav-place-more')
      await expect(thirdItem(page)).toHaveText('Papierkorb')
      await expect(thirdItem(page)).toHaveClass(/is-selected/)
      await openMore(page)
      await expect(moreButton(page)).toHaveClass(/is-open/)
      await expect(moreButton(page)).not.toHaveClass(/is-selected/)
      await expect(moreButton(page)).not.toHaveAttribute('aria-current', 'page')
      expect(await current(page)).toBe('app-nav-place-more')
      await expect(heute(page)).not.toHaveClass(/is-selected/)
      await expect(statistik(page)).not.toHaveClass(/is-selected/)
    })

    test('sequence: Heute -> Statistik -> Heute, one click each, the bar is not remounted', async ({ page }) => {
      await page.goto('/tasks')
      await appNav(page).evaluate(el => { (el as HTMLElement & { __mark?: string }).__mark = 'same-node' })
      await goToPlace(page, 'Statistik')
      await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
      await goToPlace(page, 'Heute')
      await expect.poll(() => current(page)).toBe('app-nav-place-board')
      expect(await appNav(page).evaluate(el => (el as HTMLElement & { __mark?: string }).__mark)).toBe('same-node')
    })

    // #583 (Glide): a page behind ⋯ grows as a third segment, one indicator stretches between the segments
    test('Heute -> Einstellungen -> Heute: the third segment grows, the indicator follows it and glides back', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.getByTestId('app-nav-third')).toHaveCount(0)
      await expectIndicatorOn(page, heute(page))

      await openSettings(page)
      await expect.poll(() => current(page)).toBe('app-nav-place-more')
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toHaveText('Einstellungen')
      await expect(thirdItem(page)).toHaveAttribute('href', '/settings')
      await expectIndicatorOn(page, thirdItem(page))
      await expect(moreButton(page)).not.toHaveAttribute('aria-current', 'page')

      await goToPlace(page, 'Heute')
      await waitForNavIdle(page)
      await expect(page.getByTestId('app-nav-third')).toHaveCount(0)
      await expectIndicatorOn(page, heute(page))
      // the page is reachable through ⋯ again
      await expect((await openMore(page)).getByTestId('more-settings')).toBeVisible()
      await closeMore(page)
    })

    test('Einstellungen <-> Papierkorb via ⋯: the segment relabels, the indicator stays on it', async ({ page }) => {
      await page.goto('/settings')
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toHaveText('Einstellungen')
      await openTrash(page)
      await expect.poll(() => current(page)).toBe('app-nav-place-more')
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toHaveText('Papierkorb')
      await expect(thirdItem(page)).toHaveAttribute('href', '/trash')
      await expectIndicatorOn(page, thirdItem(page))
      const panel = await openMore(page)
      await expect(panel.getByTestId('more-trash')).toHaveCount(0)
      await expect(panel.getByTestId('more-settings')).toBeVisible() // the row of the page that left the pill is back
      await panel.getByTestId('more-settings').click()
      await expect(page).toHaveURL(/\/settings$/)
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toHaveText('Einstellungen')
      await expectIndicatorOn(page, thirdItem(page))
    })

    test('a retarget mid-move continues from where the segment is: Heute while it grows, then back to Einstellungen', async ({ page }) => {
      await page.goto('/tasks')
      await openSettings(page)
      await goToPlace(page, 'Heute') // the segment is still growing or just done: it shrinks from its current width
      await waitForNavIdle(page)
      await expect(page.getByTestId('app-nav-third')).toHaveCount(0)
      await expectIndicatorOn(page, heute(page))

      await page.goto('/settings')
      await waitForNavIdle(page)
      await goToPlace(page, 'Statistik')
      await page.goBack() // back onto /settings while the segment is leaving
      await expect.poll(() => current(page)).toBe('app-nav-place-more')
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toBeVisible()
      await expectIndicatorOn(page, thirdItem(page))
    })

    // #643 review: a retarget while a move runs cancels it and continues from the current width. A running animation
    // beats the inline hold, so a move left running for the two-frame wait grows past the width the shrink starts
    // from, and the segment and the pill step back when it does start.
    test('a retarget mid-move continues from the width on screen: the shrink starts from the widest the segment got', async ({ page }) => {
      await page.goto('/tasks')
      await waitForNavIdle(page)
      const panel = await openMore(page)
      await page.evaluate(() => {
        const w = window as Window & { __retarget: { clicked: boolean, widest: number, shrinkFrom: number | null } }
        w.__retarget = { clicked: false, widest: 0, shrinkFrom: null }
        const state = w.__retarget
        const orig = Element.prototype.animate
        Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
          const frames = args[0] as Keyframe[]
          if (this.classList.contains('app-nav-third') && state.clicked && Number(frames[1]?.opacity) === 0 && state.shrinkFrom === null) {
            state.shrinkFrom = Number.parseFloat(String(frames[0]!.width))
          }
          return orig.apply(this, args)
        }
        const tick = () => {
          const third = document.querySelector('.app-nav-third')
          if (third && state.shrinkFrom === null) {
            const width = third.getBoundingClientRect().width
            state.widest = Math.max(state.widest, width)
            // retarget in the middle of the grow
            if (!state.clicked && third.getAnimations().length && width > 40) {
              state.clicked = true
              ;(document.querySelector('[data-testid="app-nav-place-board"]') as HTMLElement).click()
            }
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await panel.getByTestId('more-settings').click()
      // the probe clicks Heute by itself half-way through the grow; only then is there something to wait out
      await expect.poll(() => page.evaluate(() => (window as Window & { __retarget: { shrinkFrom: number | null } }).__retarget.shrinkFrom)).not.toBeNull()
      await expect(thirdItem(page)).toHaveCount(0)
      await waitForNavIdle(page)
      await expect(page).toHaveURL(/\/tasks(\?.*)?$/)
      const { widest, shrinkFrom } = await page.evaluate(() => (window as Window & { __retarget: { widest: number, shrinkFrom: number } }).__retarget)
      expect(shrinkFrom, 'the retarget happened mid-move: the segment is neither empty nor done').toBeGreaterThan(40)
      // every width the segment showed up to the first frame of the shrink is at most the width the shrink starts from
      expect(widest).toBeLessThanOrEqual(shrinkFrom + 0.5)
    })

    // #643 review: Einstellungen <-> Papierkorb only changes the label; while the segment holds for the first frame
    // nothing in the pill animates, but `data-moving` stays true from the start of the move to its end
    test('Einstellungen to Papierkorb keeps data-moving set from the start of the move until it is done', async ({ page }) => {
      await page.goto('/settings')
      await waitForNavIdle(page)
      await page.evaluate(() => {
        const w = window as Window & { __moving: boolean[] }
        w.__moving = []
        const nav = document.querySelector('[data-testid="app-nav"]')!
        let seen = false
        const tick = () => {
          if (!seen && document.querySelector('.app-nav-third')?.textContent?.includes('Papierkorb')) seen = true
          if (seen) w.__moving.push(nav.getAttribute('data-moving') === 'true')
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await openTrash(page)
      await expect(thirdItem(page)).toHaveText('Papierkorb')
      await waitForNavIdle(page)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const moving = await page.evaluate(() => (window as Window & { __moving: boolean[] }).__moving)
      expect(moving.length).toBeGreaterThan(3)
      expect(moving[0], 'data-moving is set on the first frame of the label change').toBe(true)
      // one run of true, then false: it never drops for a frame and comes back
      expect(moving.map(Number).join('').replace(/^1+/, '')).toMatch(/^0*$/)
    })

    // #616: the grey pill is as wide as its content on the one 420 ms timeline: no step at the first or last frame
    // (the pill's flex gap used to add 1px the moment the segment mounted) and no frame where it differs from its content
    test('the pill follows the third segment frame by frame: no step at either end, always as wide as its content', async ({ page }) => {
      await page.goto('/tasks')
      await waitForNavIdle(page)
      /** Pauses every script animation as it starts, then seeks the nav's animations to `fraction` and measures the pill */
      const holdMoves = () => page.evaluate(() => {
        const w = window as Window & { __release?: () => void }
        const orig = Element.prototype.animate
        Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
          const animation = orig.apply(this, args)
          animation.pause()
          return animation
        }
        w.__release = () => { Element.prototype.animate = orig }
      })
      const seek = (fraction: number) => page.evaluate((f) => {
        const nav = document.querySelector('[data-testid="app-nav"]')!
        for (const animation of nav.getAnimations({ subtree: true })) {
          // the segment (script) and the phone's brand fold and padding (CSS transitions): all on the one 420 ms timeline
          animation.pause()
          animation.currentTime = f * 420
        }
        const pillEl = nav.querySelector('.app-nav-pill')!
        const last = pillEl.lastElementChild!
        const style = getComputedStyle(pillEl)
        const inner = last.getBoundingClientRect().right - pillEl.getBoundingClientRect().left
        // the room the third segment takes beyond its neighbour's right edge: its width plus the gap it adds
        const third = pillEl.querySelector('.app-nav-third')
        const room = third ? third.getBoundingClientRect().right - third.previousElementSibling!.getBoundingClientRect().right : 0
        return { width: pillEl.getBoundingClientRect().width, room, content: inner + Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth) }
      }, fraction)
      const release = () => page.evaluate(async () => {
        (window as Window & { __release?: () => void }).__release?.()
        for (const animation of document.querySelector('[data-testid="app-nav"]')!.getAnimations({ subtree: true })) animation.finish()
      })

      for (const move of ['grow', 'leave'] as const) {
        // the panel opens first: holding every script animation would freeze its own open animation too
        const panel = move === 'grow' ? await openMore(page) : null
        await holdMoves()
        if (panel) await panel.getByTestId('more-settings').click()
        else await goToPlace(page, 'Heute')
        // #643: the move starts on the first frame after the route change; until then the segment holds its start state
        // (the phone's brand fold and padding transitions start with the class that flips in the same step)
        await page.waitForFunction(grows => document.querySelector('.app-nav-third')?.getAnimations().length && document.querySelector('.app-nav')!.classList.contains('has-third') === grows, move === 'grow')
        for (let i = 0; i <= 8; i++) {
          const { width, content, room } = await seek(i / 8)
          expect(Math.abs(width - content), `the pill is as wide as its content at ${i}/8 of the move`).toBeLessThanOrEqual(0.5)
          // the empty end of the move: the segment takes no room, not even the flex gap (the 1px step this guards)
          if (i === (move === 'grow' ? 0 : 8)) expect(room, `the segment takes no room at the ${move === 'grow' ? 'start' : 'end'} of the move`).toBeLessThanOrEqual(0.5)
        }
        await release()
        await waitForNavIdle(page)
        if (move === 'grow') await expect(page).toHaveURL(/\/settings$/)
      }
    })

    // #643: the first frame after a route change lays out and paints the new page and can outlast the whole 420 ms move
    // on a slow main thread; a timeline that starts before it is over when it is on screen (segment and pill jump)
    test('the move starts after the first frame of the route change; until then the segment holds its start state', async ({ page }) => {
      await page.goto('/tasks')
      await waitForNavIdle(page)
      type Probe = Window & { __frames: number, __mountFrame: number | null, __atAnimate: number | null }
      await page.evaluate(() => {
        const w = window as Probe
        w.__frames = 0
        w.__atAnimate = null
        w.__mountFrame = null
        // the frame count when the segment enters the DOM: the route change has landed (it takes frames to resolve)
        new MutationObserver(() => {
          if (w.__mountFrame === null && document.querySelector('.app-nav-third')) w.__mountFrame = w.__frames
        }).observe(document.querySelector('.app-nav-pill')!, { childList: true })
        const count = () => { w.__frames++; requestAnimationFrame(count) }
        requestAnimationFrame(count)
        const orig = Element.prototype.animate
        Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
          if ((this as Element).classList.contains('app-nav-third')) w.__atAnimate = w.__frames - (w.__mountFrame ?? w.__frames)
          return orig.apply(this, args)
        }
      })
      const panel = await openMore(page)
      await panel.getByTestId('more-settings').click()
      await expect.poll(() => page.evaluate(() => (window as Probe).__atAnimate)).toBeGreaterThanOrEqual(2)
      await waitForNavIdle(page)
      await expect(thirdItem(page)).toHaveText('Einstellungen')
    })

    test('a direct load shows the third segment and the indicator in place, at rest', async ({ page }) => {
      await page.goto('/trash')
      await expect(thirdItem(page)).toHaveText('Papierkorb')
      await expectIndicatorOn(page, thirdItem(page))
      await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')
      expect(await appNav(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    })

    test('the group stays centred with the third segment shown', async ({ page }) => {
      await page.goto('/settings')
      await waitForNavIdle(page)
      const group = (await appNav(page).locator('.app-nav-group').boundingBox())!
      expect(Math.abs(group.x + group.width / 2 - size.width / 2)).toBeLessThanOrEqual(2)
      const third = (await thirdItem(page).boundingBox())!
      if (size.width < 768) {
        expect(third.width).toBeGreaterThanOrEqual(44)
        expect(third.height).toBeGreaterThanOrEqual(44)
      }
    })

    test('sequence: board -> panel -> Einstellungen -> /settings/topics (⋯ stays selected) -> Heute', async ({ page }) => {
      await page.goto('/tasks')
      await openSettings(page, 'manage')
      await expect(morePanel(page)).toBeHidden() // a row closes the panel
      await expect.poll(() => current(page)).toBe('app-nav-place-more')

      await page.getByRole('link', { name: /Themen/ }).first().click()
      await expect(page).toHaveURL(/\/settings\/topics$/)
      await expect.poll(() => current(page)).toBe('app-nav-place-more')
      await expect(thirdItem(page)).toHaveText('Einstellungen')

      await goToPlace(page, 'Heute')
      await expect.poll(() => current(page)).toBe('app-nav-place-board')
    })

    test('browser back and forward re-derive the state from the route', async ({ page }) => {
      await page.goto('/tasks')
      await goToPlace(page, 'Statistik')
      await openSettings(page)
      await expect.poll(() => current(page)).toBe('app-nav-place-more')

      await page.goBack()
      await expect(page).toHaveURL(/\/statistics$/)
      await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
      await page.goBack()
      await expect.poll(() => current(page)).toBe('app-nav-place-board')
      await page.goForward()
      await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
    })

    // #507: Nuxt's app-level route syncs only after the incoming page's Suspense resolves, so a bar reading it kept the old
    // place selected (and closed a panel opened in that gap) after the URL had changed. The bar follows the URL in one tick.
    test('the selected place never lags behind the URL while a page loads', async ({ page }) => {
      await page.goto('/tasks')
      await expect(heute(page)).toHaveAttribute('aria-current', 'page')
      await page.evaluate(() => {
        const places: Array<[string, string]> = [['/statistics', 'app-nav-place-statistics'], ['/tasks', 'app-nav-place-board']]
        const lagging: string[] = []
        ;(window as unknown as { __lagging: string[] }).__lagging = lagging
        new MutationObserver((records) => {
          // The indicator's per-frame style writes (#583) say nothing about the selection
          if (records.every(r => (r.target as HTMLElement).classList?.contains('app-nav-indicator'))) return
          const expected = places.find(([path]) => location.pathname === path)?.[1]
          const current = document.querySelector('[data-testid="app-nav"] [aria-current="page"]')?.getAttribute('data-testid')
          if (expected && current !== expected) lagging.push(`${location.pathname}: ${current}`)
        }).observe(document.body, { subtree: true, childList: true, attributes: true })
      })
      await goToPlace(page, 'Statistik')
      await goToPlace(page, 'Heute')
      await goToPlace(page, 'Statistik')
      await page.goBack()
      await expect.poll(() => current(page)).toBe('app-nav-place-board')
      expect(await page.evaluate(() => (window as unknown as { __lagging: string[] }).__lagging)).toEqual([])
    })

    test('the panel holds the board controls only on the board, the rest on every page, and never Fokus', async ({ page }) => {
      await page.goto('/tasks')
      let panel = await openMore(page)
      await expect(panel.getByRole('switch', { name: 'Karten stapeln' })).toBeVisible()
      await expect(panel.getByTestId('more-day-close')).toBeVisible()
      await expect(panel.getByTestId('more-trash')).toBeVisible()
      await expect(panel.getByTestId('more-settings')).toBeVisible()
      await expect(panel.getByTestId('more-update')).toHaveCount(0) // the web build has no App-Update row
      await expect(panel.getByTestId('more-sync')).toBeVisible()
      await expect(panel.getByText('Fokus')).toHaveCount(0)
      await closeMore(page)

      for (const path of ['/statistics', '/trash', '/settings']) {
        await page.goto(path)
        panel = await openMore(page)
        await expect(panel.getByRole('switch', { name: 'Karten stapeln' })).toHaveCount(0)
        await expect(panel.getByTestId('more-day-close')).toHaveCount(0)
        // the page the pill shows is not listed (#583); the other one is
        await expect(panel.getByTestId('more-trash')).toHaveCount(path === '/trash' ? 0 : 1)
        await expect(panel.getByTestId('more-settings')).toHaveCount(path === '/settings' ? 0 : 1)
        await expect(panel.getByTestId('more-sync')).toBeVisible()
        await closeMore(page)
      }
    })

    test('there is no back arrow on any page', async ({ page }) => {
      for (const path of ['/settings', '/settings/topics', '/trash', '/statistics']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Zurück' })).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'Zurück' })).toHaveCount(0)
      }
    })

    test('keyboard: Tab order through the bar and the panel, Enter on a row, Escape returns focus to ⋯', async ({ page }) => {
      await page.goto('/trash')
      await appNav(page).getByTestId('app-nav-brand').focus()
      await page.keyboard.press('Tab')
      await expect(heute(page)).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(statistik(page)).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(thirdItem(page)).toBeFocused() // /trash: Papierkorb is the third segment (#583)
      await page.keyboard.press('Tab')
      await expect(moreButton(page)).toBeFocused()

      await page.keyboard.press('Enter')
      const panel = morePanel(page)
      await expect(panel).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(moreButton(page)).toBeFocused()

      await page.keyboard.press('Enter')
      await expect(panel).toBeVisible()
      // Opening moves focus inside; the tab order is the row order (no Papierkorb row: it is in the bar)
      await expect(panel.getByTestId('more-trash')).toHaveCount(0)
      await expect(panel.getByTestId('more-settings')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(panel.getByTestId('more-sync')).toBeFocused()
      await panel.getByTestId('more-settings').focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/settings$/)
      await expect(morePanel(page)).toBeHidden()
      await expect(thirdItem(page)).toHaveText('Einstellungen')
    })

    test('the board tab order on the board starts with the bar (navigation first, no skip link)', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.locator('.board')).toBeVisible()
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Tab')
      await expect(appNav(page).getByTestId('app-nav-brand')).toBeFocused()
    })

    test('a rejected source puts a dot on ⋯ and the panel says why; with healthy sources ⋯ stays silent', async ({ context, page }) => {
      await page.goto('/tasks')
      await expect(moreButton(page)).toHaveAccessibleName('Mehr')
      await expect((await openMore(page)).locator('[data-testid^="sync-problem-"]')).toHaveCount(0)

      const failing = await context.browser()!.newContext({ locale: 'de-DE', viewport: size, baseURL: test.info().project.use.baseURL })
      try {
        await seedMixedBoard(failing, undefined, { notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
        const other = await failing.newPage()
        await other.goto('/tasks')
        await expect(moreButton(other)).toHaveAccessibleName('Mehr, Verbindungsproblem')
        const panel = await openMore(other)
        await expect(panel.getByTestId('sync-problem-notion')).toContainText('Notion: Verbindung prüfen')
        await expect(panel.getByTestId('sync-repair-notion')).toBeVisible()
      } finally {
        await failing.close()
      }
    })
  })
}

test.describe('App bar: third segment on a phone (#583)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
  })

  test('the brand folds away while the third segment shows and unfolds when it leaves; the bar keeps roughly its width', async ({ page }) => {
    await page.goto('/tasks')
    const brand = appNav(page).getByTestId('app-nav-brand')
    await expect(brand).toBeVisible()
    // The brand is outside the pill (#642): the bar's width is the group (brand + pill + ⋯)
    const group = appNav(page).locator('.app-nav-group')
    const before = (await group.boundingBox())!.width

    await openSettings(page)
    await waitForNavIdle(page)
    await expect(brand).toBeHidden() // folded: not focusable, not announced
    expect((await brand.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1)
    const withThird = (await group.boundingBox())!.width
    expect(Math.abs(withThird - before) / before).toBeLessThan(0.15)
    await expectIndicatorOn(page, thirdItem(page))

    await goToPlace(page, 'Heute')
    await waitForNavIdle(page)
    await expect(brand).toBeVisible()
    expect(Math.abs((await group.boundingBox())!.width - before)).toBeLessThanOrEqual(1)
  })

  for (const width of [360, 320]) {
    test(`no horizontal overflow at ${width}px with the widest third segment`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await page.goto('/settings')
      await waitForNavIdle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const group = (await appNav(page).locator('.app-nav-group').boundingBox())!
      expect(group.x).toBeGreaterThanOrEqual(0)
      expect(group.x + group.width).toBeLessThanOrEqual(width)
    })
  }
})

test.describe('App bar: reduced motion (#583)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
  })

  test('the third segment and the indicator jump: no animation runs in the bar', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    await expect(thirdItem(page)).toBeVisible()
    await expectIndicatorOn(page, thirdItem(page))
    expect(await appNav(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')

    await goToPlace(page, 'Statistik')
    await expect(page.getByTestId('app-nav-third')).toHaveCount(0)
    await expectIndicatorOn(page, statistik(page))
    expect(await appNav(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
  })

  test('at 390px the phone rules keep every change instant too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    await openSettings(page)
    await expect(thirdItem(page)).toBeVisible()
    await expectIndicatorOn(page, thirdItem(page))
    // The phone block re-declares the transitions (colour fades, brand fold); none may survive reduced motion
    const durations = await appNav(page).evaluate(el => [...el.querySelectorAll('.app-nav-place, .app-nav-more, .app-nav-brand, .app-nav-brand-text')]
      .map(node => getComputedStyle(node).transitionDuration))
    expect(durations.length).toBeGreaterThan(0)
    for (const duration of durations) expect(duration.split(',').every(d => parseFloat(d) === 0)).toBe(true)
    expect(await appNav(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')

    await goToPlace(page, 'Statistik')
    await expect(page.getByTestId('app-nav-third')).toHaveCount(0)
    await expectIndicatorOn(page, statistik(page))
    expect(await appNav(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
  })
})

/**
 * Issue #615 (DESIGN.md "The Glass Chrome Rule"): the two pills are frosted glass over a paper veil. Chromium paints the
 * blur (the WebKit render is the no-blur fallback case); the veil takes no pointer events, so the page, the cards and
 * the desktop `.titlebar` drag strip stay usable under it.
 */
for (const { label, size } of VIEWPORTS) {
  test(`App bar at ${label}: frosted pills over a paper veil that lets pointers through (#615)`, async ({ context, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit never paints backdrop-filter in headless Playwright: the fallback render')
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
    await page.setViewportSize(size)
    await page.goto('/tasks')
    await expect(appNav(page)).toBeVisible()
    for (const selector of ['.app-nav-pill', '.app-nav-more']) {
      const pill = appNav(page).locator(selector)
      expect(await pill.evaluate(el => getComputedStyle(el).backdropFilter)).toContain('blur(20px)')
      // Translucent tint, never a white fill and never fully transparent
      expect(await pill.evaluate(el => getComputedStyle(el).backgroundColor)).toMatch(/\/ 0\.6\)|, 0\.6\)/)
    }
    const veil = await appNav(page).evaluate(el => {
      const style = getComputedStyle(el, '::before')
      return { pointerEvents: style.pointerEvents, content: style.content, height: Number.parseFloat(style.height) }
    })
    expect(veil.pointerEvents).toBe('none')
    expect(veil.content).not.toBe('none')
    // Desktop: 3.5rem row + 1.75rem hang; phone: pill row + 0.75rem + 1.5rem rise
    if (label === '1280') expect(veil.height).toBeCloseTo(56 + 28, 0)
    // The phone pill keeps its 1px border (#616 size) and the border draws the hairline (#631); desktop has no border
    const border = await appNav(page).locator('.app-nav-pill').evaluate(el => {
      const style = getComputedStyle(el)
      return { width: Number.parseFloat(style.borderTopWidth), color: style.borderTopColor }
    })
    if (label === '1280') expect(border.width).toBe(0)
    else {
      expect(border.width).toBe(1)
      expect(border.color).not.toMatch(/\/ 0\)|, 0\)|transparent/)
    }
    // Keyboard focus (Tab, so :focus-visible holds whatever the pointer did before): ⋯ keeps the ink ring and the glass edge
    // and shadow (#631); the brand gets the ring too
    await appNav(page).getByRole('link', { name: 'Statistik' }).focus()
    await page.keyboard.press('Tab')
    await expect(moreButton(page)).toBeFocused()
    const focused = await moreButton(page).evaluate(el => {
      const style = getComputedStyle(el)
      return { focusVisible: el.matches(':focus-visible'), outline: style.outlineStyle, shadow: style.boxShadow }
    })
    expect(focused.focusVisible).toBe(true)
    expect(focused.outline).toBe('solid')
    expect(focused.shadow).not.toBe('none')
    await appNav(page).getByRole('link', { name: 'Heute' }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(appNav(page).getByTestId('app-nav-brand')).toBeFocused()
    expect(await appNav(page).getByTestId('app-nav-brand').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
    // A point inside the veil, outside both pills, hits the page, not the bar
    const pill = (await appNav(page).locator('.app-nav-pill').boundingBox())!
    const y = label === '1280' ? 56 + 14 : pill.y - 12
    const insideBar = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-app-nav]'), { x: pill.x + pill.width / 2, y })
    expect(insideBar).toBe(false)
  })
}

test.describe('App bar: resize and routes without a bar', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
  })

  test('resizing 1280 -> 390 -> 1280 keeps the state and moves the bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/statistics')
    await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
    const top = (await appNav(page).locator('.app-nav-pill').boundingBox())!.y

    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await appNav(page).locator('.app-nav-pill').boundingBox())!.y).toBeGreaterThan(600)
    await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
    await openMore(page)
    await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
    await closeMore(page)

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(async () => (await appNav(page).locator('.app-nav-pill').boundingBox())!.y).toBe(top)
    await expect.poll(() => current(page)).toBe('app-nav-place-statistics')
  })

  test('there is no bar on /welcome', async ({ browser, baseURL }) => {
    const fresh = await browser.newContext({ locale: 'de-DE', baseURL })
    try {
      const page = await fresh.newPage()
      await page.goto('/welcome')
      await expect(page.getByRole('button', { name: 'Noch nirgends' })).toBeVisible()
      await expect(page.getByTestId('app-nav')).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0)
    } finally {
      await fresh.close()
    }
  })
})
