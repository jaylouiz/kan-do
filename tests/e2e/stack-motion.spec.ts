import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { callTasksStore, fullTask } from './helpers/store'

/**
 * Expand/collapse motion of a stack (#197). The state change is instant and final; the motion is a
 * visual beat on top of it, flagged by `data-stack-animating` on the column's list (#187). A
 * MutationObserver, installed before the page runs, records what the DOM looked like the moment the
 * attribute was set, so the mid-animation assertions never race the 220 ms beat.
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

// Rendered Offen: u1, [a1 a2 a3], [b1 b2], c1
const OPEN = [
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
  task({ id: 'b1', title: 'API prüfen', status: 0, topic: 'Backend' }),
  task({ id: 'b2', title: 'Schema ändern', status: 0, topic: 'Backend' }),
  task({ id: 'c1', title: 'Release planen', status: 0, topic: 'Ops' }),
]
const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }

const LIST = '#column-open-list'
const stack = (page: Page, key = 'Design') => page.locator(`${LIST} .task-stack[data-stack-key="${key}"]`)
const members = (page: Page, key = 'Design') => page.locator(`${LIST} .task-wrapper[data-from-stack="${key}"]`)
const closeButton = (page: Page, key = 'Design') => page.locator(`${LIST} [data-stack-header="${key}"] button`)

interface Observed {
  value: string
  /** list items (cards, stacks) with the same task id at that moment */
  duplicateIds: string[]
  /** the clone layer, as it was when the attribute was set */
  layer: { clones: number, ariaHidden: string | null, inert: boolean, hasIds: boolean, hasTaskData: boolean, inList: boolean } | null
  /** every running animation: finite, fill none, transform/opacity/z-index only */
  animations: { finite: boolean, fill: string, props: string[] }[]
}
declare global {
  interface Window {
    __motion: Observed[]
    __motionSets: number
    /** Opt-in: the observer pauses the beat's script animations at its first or last frame, before any frame renders */
    __pauseMotion: 'start' | 'end' | null
  }
}

async function observeMotion(page: Page) {
  await page.addInitScript(() => {
    window.__motion = []
    window.__motionSets = 0
    window.__pauseMotion = null
    const watch = () => {
      const list = document.querySelector('#column-open-list')
      if (!list) return requestAnimationFrame(watch)
      new MutationObserver(() => {
        const value = list.getAttribute('data-stack-animating')
        if (value === null) return
        window.__motionSets++
        const counts = new Map<string, number>()
        document.querySelectorAll('.task-wrapper[data-task-id], .task-stack[data-task-id]').forEach((el) => {
          const id = el.getAttribute('data-task-id')!
          counts.set(id, (counts.get(id) ?? 0) + 1)
        })
        const layer = document.querySelector('[data-stack-motion-layer]')
        window.__motion.push({
          value,
          duplicateIds: [...counts].filter(([, n]) => n > 1).map(([id]) => id),
          layer: layer && {
            clones: layer.children.length,
            ariaHidden: layer.getAttribute('aria-hidden'),
            inert: [...layer.children].every(el => (el as HTMLElement).inert),
            hasIds: layer.querySelector('[id]') !== null,
            hasTaskData: layer.querySelector('[data-task-id], [data-stack-key], [data-from-stack], [data-stack-header]') !== null,
            inList: list.contains(layer),
          },
          // Script animations only: CSS transitions elsewhere on the page are not the motion
          animations: document.getAnimations().filter(animation => !(animation instanceof CSSTransition || animation instanceof CSSAnimation)).map((animation) => {
            const effect = animation.effect as KeyframeEffect
            const timing = effect.getComputedTiming()
            const props = new Set(effect.getKeyframes().flatMap(frame => Object.keys(frame)))
            ;['offset', 'computedOffset', 'easing', 'composite'].forEach(key => props.delete(key))
            return { finite: timing.iterations !== Infinity, fill: String(timing.fill), props: [...props] }
          }),
        })
        // Pausing here, in the microtask right after play() sets the attribute, beats the first rendered frame; a pause from the test after the click can lose that race under load
        if (window.__pauseMotion) {
          for (const animation of document.getAnimations()) {
            if (animation instanceof CSSTransition || animation instanceof CSSAnimation) continue
            animation.pause()
            animation.currentTime = window.__pauseMotion === 'start' ? 0 : Number(animation.effect!.getComputedTiming().endTime) - 1
          }
        }
      }).observe(list, { attributes: true, attributeFilter: ['data-stack-animating'] })
    }
    watch()
  })
}

const observed = (page: Page) => page.evaluate(() => window.__motion)
const animating = (page: Page) => page.locator(LIST).getAttribute('data-stack-animating')

/** Boxes of the list's items, rounded, as the layout rests */
const layout = (page: Page) =>
  page.locator(LIST).evaluate(list =>
    [...list.children].map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        id: el.getAttribute('data-task-id') ?? el.getAttribute('data-stack-header') ?? el.className,
        box: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
        transform: getComputedStyle(el).transform,
      }
    }),
  )

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(stack(page)).toBeVisible()
}

test.describe('Stack motion (#197)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })
  const pageErrors: string[] = []

  test.beforeEach(async ({ context, page }) => {
    pageErrors.length = 0
    page.on('pageerror', error => pageErrors.push(error.message))
    await seedLocalBoard(context, OPEN, {}, GROUP_BY_TOPIC)
    await observeMotion(page)
  })
  test.afterEach(() => {
    expect(pageErrors).toEqual([])
  })

  test('expanding flags the list while it runs, then clears it; no clone, no duplicate id, only finite fill-less transform/opacity animations', async ({ page }) => {
    await gotoBoard(page)
    expect(await animating(page)).toBeNull()

    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await expect(page.locator(LIST)).not.toHaveAttribute('data-stack-animating', /.*/)

    const [first, ...rest] = await observed(page)
    expect(rest).toEqual([])
    expect(first!.value).toBe('expand')
    expect(first!.duplicateIds).toEqual([])
    // The only clone is the face's wash (#578); the pill travels as the header's own element
    expect(first!.layer).toEqual({ clones: 1, ariaHidden: 'true', inert: true, hasIds: false, hasTaskData: false, inList: false })
    expect(first!.animations.length).toBeGreaterThan(0)
    for (const animation of first!.animations) {
      expect(animation.finite).toBe(true)
      expect(animation.fill).toBe('none')
      expect(animation.props.filter(prop => !['transform', 'transformOrigin', 'opacity', 'zIndex'].includes(prop))).toEqual([])
    }
    await settleAnimations(page)
    expect((await layout(page)).every(item => item.transform === 'none')).toBe(true)
  })

  test('frame 0 of an expand has the first card exactly on the collapsed face, the next ones in the peek layers; a collapse ends on the face the same way', async ({ page }) => {
    await gotoBoard(page)
    const faceCard = stack(page).locator('.stacked-task--top')
    const face = (await faceCard.boundingBox())!
    const rectOf = (selector: string, index: number) =>
      page.locator(selector).nth(index).evaluate((el) => {
        const { x, y, width, height } = el.getBoundingClientRect()
        return { x, y, width, height }
      })
    const near = (actual: { x: number, y: number, width: number }, expected: { x: number, y: number, width: number }) => {
      expect(Math.abs(actual.x - expected.x)).toBeLessThan(1.5)
      expect(Math.abs(actual.y - expected.y)).toBeLessThan(1.5)
      expect(Math.abs(actual.width - expected.width)).toBeLessThan(1.5)
    }

    const pauseNextBeat = (time: 'start' | 'end') => page.evaluate((at) => { window.__motion.length = 0; window.__pauseMotion = at }, time)
    const beatPaused = () => expect.poll(() => page.evaluate(() => window.__motion.length)).toBe(1)

    await pauseNextBeat('start')
    await stack(page).click()
    await beatPaused()
    const cardSelector = `${LIST} .task-wrapper[data-from-stack="Design"] .task`
    // On desktop the card is narrower than its full-width wrapper: the card, not the wrapper, has to land on the face
    near(await rectOf(cardSelector, 0), face)
    near(await rectOf(cardSelector, 1), { x: face.x + 4, y: face.y + 4, width: face.width - 8 })
    near(await rectOf(cardSelector, 2), { x: face.x + 8, y: face.y + 8, width: face.width - 16 })

    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()))
    await settleAnimations(page)
    await expect(members(page)).toHaveCount(3)
    await pauseNextBeat('end')
    await closeButton(page).click()
    await beatPaused()
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator('[data-stack-motion-layer] .task')).toHaveCount(3)
    near(await rectOf('[data-stack-motion-layer] .task', 0), face)
    await page.evaluate(() => { window.__pauseMotion = null })
  })

  test('collapsing plays clones of the members in a layer outside the list, then removes it', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    await page.evaluate(() => { window.__motion.length = 0 })

    await closeButton(page).click()
    await expect(stack(page)).toHaveCount(1)
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator(LIST)).not.toHaveAttribute('data-stack-animating', /.*/)

    const [run, ...rest] = await observed(page)
    expect(rest).toEqual([])
    expect(run!.value).toBe('collapse')
    expect(run!.duplicateIds).toEqual([])
    expect(run!.layer).toEqual({ clones: 6, // 3 members, the header row, the pill and the wash (#578)
       ariaHidden: 'true', inert: true, hasIds: false, hasTaskData: false, inList: false })
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)
    expect((await layout(page)).every(item => item.transform === 'none')).toBe(true)
  })

  test('the front clone\'s content ends the fold at the muted token, so the face revealed under it does not pop (#378)', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    const token = await page.locator(LIST).evaluate(list => Number.parseFloat(getComputedStyle(list).getPropertyValue('--stack-front-content-opacity')))
    await page.evaluate(() => { window.__pauseMotion = 'end' })

    await closeButton(page).click()
    await expect(page.locator('[data-stack-motion-layer] .task')).toHaveCount(3)
    const clone = page.locator('[data-stack-motion-layer] .task').first()
    const clonedContent = await clone.evaluate(el => [...el.children].map(child => Number.parseFloat(getComputedStyle(child).opacity)))
    expect(clonedContent.length).toBeGreaterThan(0)
    for (const opacity of clonedContent) expect(opacity).toBeCloseTo(token, 1)
    await page.evaluate(() => { window.__pauseMotion = null })
  })

  test('the resting layout after the motion equals the layout without it (expanded and collapsed)', async ({ browser, context, page }) => {
    await gotoBoard(page)
    const reduced = await context.newPage()
    await reduced.emulateMedia({ reducedMotion: 'reduce' })
    await observeMotion(reduced)
    await gotoBoard(reduced)
    const collapsedBefore = await layout(reduced)

    for (const p of [page, reduced]) {
      await stack(p).click()
      await expect(members(p)).toHaveCount(3)
      await settleAnimations(p)
    }
    const expanded = await layout(page)
    expect(expanded.map(item => item.box)).toEqual((await layout(reduced)).map(item => item.box))
    expect(expanded.some(item => item.id === 'a2')).toBe(true)

    for (const p of [page, reduced]) {
      await closeButton(p).click()
      await expect(members(p)).toHaveCount(0)
      await settleAnimations(p)
    }
    expect(await layout(page)).toEqual(await layout(reduced))
    expect((await layout(page)).map(item => item.box)).toEqual(collapsedBefore.map(item => item.box))
    void browser
  })

  test('an outside click collapsing two groups at once plays one collapse with all clones; Esc plays it too', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await stack(page, 'Backend').click()
    await expect(members(page, 'Backend')).toHaveCount(2)
    await settleAnimations(page)
    await page.evaluate(() => { window.__motion.length = 0 })

    await page.click('body', { position: { x: 20, y: 600 } })
    await expect(page.locator(`${LIST} [data-from-stack]`)).toHaveCount(0)
    await settleAnimations(page)
    const collapse = (await observed(page)).filter(run => run.value === 'collapse')
    expect(collapse).toHaveLength(1)
    expect(collapse[0]!.layer!.clones).toBe(3 + 2 + 2 * 3) // members of both groups, and per group its header row, pill and wash
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)

    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    await page.evaluate(() => { window.__motion.length = 0 })
    await page.keyboard.press('Escape')
    await expect(members(page)).toHaveCount(0)
    expect((await observed(page)).map(run => run.value)).toEqual(['collapse'])
  })

  test('the pill is one object that moves: same width on the face and in the header, it rises from the face centre and sinks back onto it (#578)', async ({ page }) => {
    await gotoBoard(page)
    const widthOf = (selector: string) => page.locator(selector).first().evaluate(el => el.getBoundingClientRect().width)
    const centreOf = (selector: string) => page.locator(selector).first().evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, opacity: Number(getComputedStyle(el).opacity) }
    })
    const pauseNextBeat = (time: 'start' | 'end') => page.evaluate((at) => { window.__motion.length = 0; window.__pauseMotion = at }, time)
    const beatPaused = () => expect.poll(() => page.evaluate(() => window.__motion.length)).toBe(1)
    const facePill = `${LIST} .task-stack[data-stack-key="Design"] .task-stack-pill`
    const headerPill = `${LIST} [data-stack-header="Design"] .task-stack-pill`

    const collapsedWidth = await widthOf(facePill)
    const faceCentre = await centreOf(facePill)
    await pauseNextBeat('start')
    await stack(page).click()
    await beatPaused()
    // First frame: the header's pill sits where the face's pill was, fully visible (no fade-in from nothing)
    const start = await centreOf(headerPill)
    expect(Math.abs(start.x - faceCentre.x)).toBeLessThan(1.5)
    expect(Math.abs(start.y - faceCentre.y)).toBeLessThan(1.5)
    expect(start.opacity).toBe(1)
    await page.evaluate(() => { window.__pauseMotion = null; document.getAnimations().forEach(animation => animation.finish()) })
    await settleAnimations(page)
    expect(Math.abs((await widthOf(headerPill)) - collapsedWidth)).toBeLessThan(0.5)
    const headerCentre = await centreOf(headerPill)
    expect(headerCentre.y).toBeLessThan(faceCentre.y)

    // Collapse, first frame: the pill clone is where the header pill was and the real face (cards, pill) is hidden under the clones
    await pauseNextBeat('start')
    await closeButton(page).click()
    await beatPaused()
    const layerPill = await centreOf('[data-stack-motion-layer] .task-stack-pill')
    expect(Math.abs(layerPill.x - headerCentre.x)).toBeLessThan(1.5)
    expect(Math.abs(layerPill.y - headerCentre.y)).toBeLessThan(1.5)
    expect(await page.locator(`${LIST} .task-stack[data-stack-key="Design"] .task-stack__cards`).evaluate(el => getComputedStyle(el).opacity)).toBe('0')
    expect(await page.locator(`${LIST} .task-stack[data-stack-key="Design"] .task-stack__pill-layer`).evaluate(el => getComputedStyle(el).opacity)).toBe('0')
    await page.evaluate(() => { window.__pauseMotion = null; document.getAnimations().forEach(animation => animation.finish()) })
    await settleAnimations(page)
    expect(Math.abs((await widthOf(facePill)) - collapsedWidth)).toBeLessThan(0.5)
    expect(await page.locator(`${LIST} .task-stack[data-stack-key="Design"] .task-stack__cards`).evaluate(el => getComputedStyle(el).opacity)).toBe('1')
  })

  test('the expanded header is the pill and a round X named after the group; no caption, no text "Schließen" (#578)', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    const header = page.locator(`${LIST} [data-stack-header="Design"]`)
    await expect(header.locator('.task-stack-pill')).toBeVisible()
    await expect(header.locator('.task-stack-caption')).toHaveCount(0)
    await expect(header).not.toContainText('Schließen')
    const close = header.getByRole('button', { name: 'Gruppe Design schließen' })
    const box = (await close.boundingBox())!
    expect(Math.round(box.width)).toBe(24)
    expect(Math.round(box.height)).toBe(24)
    const pill = (await header.locator('.task-stack-pill').boundingBox())!
    expect(box.x).toBeGreaterThan(pill.x + pill.width) // beside the pill, never squeezing it
  })

  test('a keyboard expand moves focus as before and animates', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).locator('.task-stack__control').focus()
    await page.keyboard.press('Enter')
    await expect(members(page)).toHaveCount(3)
    await expect(members(page).first()).toBeFocused()
    expect((await observed(page)).map(run => run.value)).toEqual(['expand'])
  })

  test('the details pill stays on the front card through a collapse and rests centred on it (#195, #371)', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await closeButton(page).click()
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator(LIST)).not.toHaveAttribute('data-stack-animating', /.*/)
    await settleAnimations(page)
    const pill = stack(page).locator('.task-stack-pill')
    await expect(pill).toHaveCSS('opacity', '1')
    const front = (await stack(page).locator('.stacked-task--top').boundingBox())!
    const box = (await pill.boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - (front.x + front.width / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(box.y + box.height / 2 - (front.y + front.height / 2))).toBeLessThanOrEqual(1)
  })

  test('a quick toggle (expand, then Esc) ends collapsed, with no layer, attribute or stuck transform', async ({ page }) => {
    await gotoBoard(page)
    const before = await layout(page)
    await stack(page).click()
    await page.keyboard.press('Escape')
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator(LIST)).not.toHaveAttribute('data-stack-animating', /.*/)
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)
    await settleAnimations(page)
    expect((await layout(page)).map(item => item.box)).toEqual(before.map(item => item.box))
    expect((await layout(page)).every(item => item.transform === 'none')).toBe(true)
  })

  test('a drag started during the beat cancels it and works', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)

    const source: Locator = members(page).nth(1)
    const box = (await source.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // The pointerdown cancelled the beat: nothing animates and no stack transform is left
    await expect(page.locator(LIST)).not.toHaveAttribute('data-stack-animating', /.*/)
    await page.waitForTimeout(150)
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 })
    await expect(page.locator('.board')).toHaveClass(/dragging/)
    expect((await layout(page)).every(item => item.transform === 'none' || item.id.includes('dragged'))).toBe(true)
    await page.mouse.up()
    await expect(page.locator('.board')).not.toHaveClass(/dragging/)
    await expect(members(page)).toHaveCount(3)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('a sync that adds or removes members, and a group shrinking to one card, never animate', async ({ page }) => {
    await gotoBoard(page)
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    expect(await page.evaluate(() => window.__motionSets)).toBe(1)

    await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'a4', title: 'Neu im Stapel', status: 0, topic: 'Design' })] })
    await expect(members(page)).toHaveCount(4)
    await callTasksStore(page, { action: 'removeTask', args: ['a4'] })
    await callTasksStore(page, { action: 'removeTask', args: ['a3'] })
    await callTasksStore(page, { action: 'removeTask', args: ['a2'] })
    // Design is one card now: pruned, not collapsed by a gesture
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator(`${LIST} .task-wrapper[data-task-id="a1"]`)).toHaveCount(1)
    expect(await page.evaluate(() => window.__motionSets)).toBe(1)
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)
  })
})

test.describe('Stack motion: reduced motion (#197)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } })

  test('never sets the attribute, makes no clone and no animation: the swap is instant', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN, {}, GROUP_BY_TOPIC)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await observeMotion(page)
    await gotoBoard(page)

    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    // Script animations only: CSS transitions elsewhere on the page are not the motion
    expect(await page.evaluate(() => document.getAnimations().filter(a => !(a instanceof CSSTransition || a instanceof CSSAnimation)).length)).toBe(0)
    await closeButton(page).click()
    await expect(members(page)).toHaveCount(0)
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)
    expect(await page.evaluate(() => window.__motionSets)).toBe(0)
  })
})

test.describe('Stack motion at 390px (#197)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('a tap expands with the beat, the X collapses with it; the layout rests where it did', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN, {}, GROUP_BY_TOPIC)
    await observeMotion(page)
    await gotoBoard(page)
    const before = (await layout(page)).map(item => item.box)

    await stack(page).tap()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)
    await closeButton(page).tap()
    await expect(members(page)).toHaveCount(0)
    await settleAnimations(page)

    expect((await observed(page)).map(run => run.value)).toEqual(['expand', 'collapse'])
    expect((await layout(page)).map(item => item.box)).toEqual(before)
    await expect(page.locator('[data-stack-motion-layer]')).toHaveCount(0)
  })
})
