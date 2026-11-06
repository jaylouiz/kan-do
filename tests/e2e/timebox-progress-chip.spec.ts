/**
 * E2E (#388): the timebox label of a card is its progress item. Outside Jetzt a grey chip whose fill is the spent
 * share; in Jetzt, after the card settled, a bar across the whole footer (`12 min ...... 45 min`) in primary and
 * warning above 80 %; leaving Jetzt springs back to the grey chip with the fill kept. The ring is gone from the
 * cards (the task sheet keeps its own). Time is seeded (`timeSpentSeconds`), never waited for; reads after the
 * spring poll, never one-shot.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { carriedOverDays, seedLocalBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { hover, pickUp, showColumnPage } from './helpers/dnd'
import { settleAnimations } from './helpers/settle'

const CHIP = '[data-testid="task-progress-chip"]'
const JETZT_ID = 'seed-progress-1' // timebox 1 h

const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`).first()
const chip = (page: Page, id: string) => card(page, id).locator(CHIP)
const column = (page: Page, key: 'open' | 'progress' | 'waiting' | 'done') => page.locator(`#column-${key}-list`)

/** The seed board with the Jetzt card at `spent` seconds of its 3600 s timebox */
const withJetztSpent = (spent: number): SeedTask[] =>
  SEED_TASKS.map(t => (t.id === JETZT_ID ? { ...t, timeSpentSeconds: spent } : t))

const widthOf = async (target: Locator) => (await target.boundingBox())!.width
const footerWidthOf = (page: Page, id: string) => widthOf(card(page, id).locator('.task-footer'))

/** The bar spans the footer once the spring has settled (the width eases to 1.0 after ~0.6 s plus the settle delay) */
async function expectBar(page: Page, id: string) {
  await expect(chip(page, id)).toHaveClass(/chip--now/)
  await expect.poll(async () => Math.abs((await widthOf(chip(page, id))) - (await footerWidthOf(page, id))), { timeout: 5000 }).toBeLessThan(2)
}

async function expectCollapsed(page: Page, id: string) {
  await expect(chip(page, id)).not.toHaveClass(/chip--now/)
  await expect.poll(async () => await widthOf(chip(page, id)), { timeout: 5000 }).toBeLessThan(80)
}

/** Share of the chip's width that the fill covers */
const fillShare = async (target: Locator) =>
  target.evaluate((el) => {
    const fill = el.querySelector('.chip__fill')!.getBoundingClientRect()
    return fill.width / el.getBoundingClientRect().width
  })

async function drag(page: Page, id: string, to: 'open' | 'progress' | 'waiting' | 'done') {
  await pickUp(page, page.locator(`.task-wrapper[data-task-id="${id}"]`).first())
  await hover(page, column(page, to))
  await page.mouse.up()
  await expect(page.locator('.board.dragging')).toHaveCount(0)
  await expect(page.locator('.kando-dnd-preview')).toHaveCount(0)
}

test.describe('timebox progress chip (#388)', () => {
  test('outside Jetzt the chip is grey, carries the spent share, and no ring is left on the cards', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === 'seed-open-2' ? { ...t, timeSpentSeconds: 1350 } : t)))
    await page.goto('/tasks')

    const open = chip(page, 'seed-open-2')
    await expect(open.locator('.chip__box')).toHaveText('45 min')
    await expect(open).toHaveAttribute('aria-label', 'Timebox: 23 min von 45 min')
    await expect(open).toHaveAttribute('aria-valuenow', '50')
    await expect(open).toHaveClass(/chip--idle/)
    expect(await fillShare(open)).toBeCloseTo(0.5, 1)

    // Done card: grey chip with its fill and the teal corner check, no ring
    await expect(chip(page, 'seed-done-1')).toHaveClass(/chip--idle/)
    await expect(card(page, 'seed-done-1').locator('.task-done-check')).toBeVisible()
    await expect(page.locator('.task-progress-circular')).toHaveCount(0)
    await expect(page.locator('[data-testid="task-current-elapsed"], .task-current-elapsed')).toHaveCount(0)

    // No timebox, no time: no label
    await expect(chip(page, 'seed-open-1')).toHaveCount(0)
    await expect(chip(page, 'seed-waiting-1')).toHaveCount(0)
  })

  test('overrun on a card outside Jetzt stays grey and the fill is full', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === 'seed-open-2' ? { ...t, timeSpentSeconds: 4000 } : t)))
    await page.goto('/tasks')
    const open = chip(page, 'seed-open-2')
    await expect(open).toHaveClass(/chip--idle/)
    await expect(open).toHaveAttribute('aria-valuenow', '100')
    expect(await fillShare(open)).toBeCloseTo(1, 1)
  })

  test('a card without a timebox shows a quiet grey spent chip once time was spent', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === 'seed-open-1' ? { ...t, timeSpentSeconds: 720 } : t)))
    await page.goto('/tasks')
    const open = chip(page, 'seed-open-1')
    await expect(open).toHaveText('12 min')
    await expect(open).toHaveClass(/chip--boxless/)
    await expect(open).not.toHaveAttribute('aria-valuenow', /.*/)
  })

  test('a page load with a card in Jetzt shows the bar at once, without animation', async ({ context, page }) => {
    await seedLocalBoard(context, withJetztSpent(1800))
    await page.goto('/tasks')
    const jetzt = chip(page, JETZT_ID)
    await expect(jetzt).toHaveClass(/chip--now/)
    expect(await jetzt.evaluate(el => el.getAnimations().length)).toBe(0)
    await expectBar(page, JETZT_ID)
    await expect(jetzt.locator('.chip__spent-inner')).toHaveText('30 min')
    await expect(jetzt.locator('.chip__box')).toHaveText('1 h')
    await expect(jetzt).toHaveClass(/chip--primary/)
  })

  test('the bar is anchored at the footer start and the collapsed chip sits there too (#584)', async ({ context, page }) => {
    await seedLocalBoard(context, withJetztSpent(1800))
    await page.goto('/tasks')
    const footerX = async (id: string) => (await card(page, id).locator('.task-footer').boundingBox())!.x
    await expectBar(page, JETZT_ID)
    expect(Math.abs((await chip(page, JETZT_ID).boundingBox())!.x - (await footerX(JETZT_ID)))).toBeLessThanOrEqual(1)
    await expectCollapsed(page, 'seed-open-2')
    expect(Math.abs((await chip(page, 'seed-open-2').boundingBox())!.x - (await footerX('seed-open-2')))).toBeLessThanOrEqual(1)
  })

  for (const [label, spent, tone, value] of [
    ['50 %', 1800, 'primary', '50'],
    ['85 %', 3060, 'warning', '85'],
    ['over the timebox', 4300, 'warning', '100'],
  ] as const) {
    test(`Jetzt bar at ${label} is ${tone}`, async ({ context, page }) => {
      await seedLocalBoard(context, withJetztSpent(spent))
      await page.goto('/tasks')
      await expectBar(page, JETZT_ID)
      const jetzt = chip(page, JETZT_ID)
      await expect(jetzt).toHaveClass(new RegExp(`chip--${tone}`))
      await expect(jetzt).toHaveAttribute('aria-valuenow', value)
      // Everything else is grey: only the Jetzt card is coloured
      await expect(page.locator(`${CHIP}.chip--primary, ${CHIP}.chip--warning`)).toHaveCount(1)
    })
  }

  test('drag out of Jetzt: back to the grey chip with the fill kept; drag a card in: it grows (A -> B -> A)', async ({ context, page }) => {
    await seedLocalBoard(context, withJetztSpent(1800))
    await page.goto('/tasks')
    await expectBar(page, JETZT_ID)

    // out of Jetzt: the preview springs back at once, the card lands collapsed
    await pickUp(page, page.locator(`.task-wrapper[data-task-id="${JETZT_ID}"]`).first())
    const preview = page.locator('.kando-dnd-preview')
    await expect(preview.locator(CHIP)).not.toHaveClass(/chip--now/)
    await hover(page, column(page, 'waiting'))
    await page.mouse.up()
    await expect(page.locator('.kando-dnd-preview')).toHaveCount(0)
    await expect(column(page, 'waiting').locator(`.task[data-task-id="${JETZT_ID}"]`)).toHaveCount(1)
    await expectCollapsed(page, JETZT_ID)
    await expect(chip(page, JETZT_ID)).toHaveClass(/chip--idle/)
    await expect(chip(page, JETZT_ID).locator('.chip__box')).toHaveText('1 h')
    expect(await fillShare(chip(page, JETZT_ID))).toBeCloseTo(0.5, 1)
    // landed collapsed: nothing is animating toward the bar
    expect(await chip(page, JETZT_ID).evaluate(el => el.classList.contains('chip--now'))).toBe(false)

    // another card lands in Jetzt: collapsed first, then the bar
    await settleAnimations(page)
    await drag(page, 'seed-open-2', 'progress')
    await expect(column(page, 'progress').locator('.task[data-task-id="seed-open-2"]')).toHaveCount(1)
    await expectBar(page, 'seed-open-2')
    await expect(chip(page, 'seed-open-2').locator('.chip__box')).toHaveText('45 min')
    await expect(chip(page, 'seed-open-2').locator('.chip__spent-inner')).toHaveText('<1 min')

    // and back out again: the first card is untouched
    await expectCollapsed(page, JETZT_ID)
  })

  test.describe('the morph repeats on every round trip (#411)', () => {
    /**
     * Records which chips play a motion from now on, by where they live: `transitionrun` on a chip's height (every chip
     * eases it between the grey chip and the bar, a boxless one has no width to ease). Asserting the
     * motion itself, not only the end state: a card that never re-renders its chip ends in the right state
     * without morphing, which is the bug.
     */
    const startRecording = (page: Page) =>
      page.evaluate(() => {
        const w = window as unknown as { __chipMotion?: string[]; __chipHooked?: boolean }
        w.__chipMotion = []
        if (w.__chipHooked) return
        w.__chipHooked = true
        const where = (el: Element) => (el.closest('.kando-dnd-preview') ? 'preview' : 'card')
        document.addEventListener('transitionrun', (e) => {
          const el = e.target as Element
          if (e.propertyName === 'height' && el.classList?.contains('chip')) w.__chipMotion!.push(`${where(el)}:chip`)
        }, true)
      })
    const motion = (page: Page) => page.evaluate(() => (window as unknown as { __chipMotion: string[] }).__chipMotion)
    const expectMotion = (page: Page, entry: string) =>
      expect.poll(() => motion(page), { message: `chip motion ${entry}`, timeout: 5000 }).toContain(entry)

    const jetztWrapper = (page: Page) => page.locator(`.task-wrapper[data-task-id="${JETZT_ID}"]`).first()

    /** Lift the Jetzt card: the preview's chip shrinks while the card sits in the pointer's hand (a boxless chip has
     *  no bar to shrink: the preview just shows the grey chip) */
    async function liftFromJetzt(page: Page, { boxless = false } = {}) {
      await startRecording(page)
      await pickUp(page, jetztWrapper(page))
      await expect(page.locator('.kando-dnd-preview').locator(CHIP)).not.toHaveClass(/chip--now/)
      if (!boxless) await expectMotion(page, 'preview:chip')
    }

    /** Release over Jetzt: the card is back in Jetzt and its bar grows again */
    async function dropIntoJetzt(page: Page, { boxless = false } = {}) {
      await hover(page, column(page, 'progress'))
      await startRecording(page)
      await page.mouse.up()
      await expect(page.locator('.kando-dnd-preview')).toHaveCount(0)
      await expect(column(page, 'progress').locator(`.task[data-task-id="${JETZT_ID}"]`)).toHaveCount(1)
      await expectMotion(page, 'card:chip')
      if (boxless) await expect(chip(page, JETZT_ID)).toHaveClass(/chip--now/)
      else await expectBar(page, JETZT_ID)
    }

    test('timebox: Jetzt -> lift -> Jetzt twice, every lift shrinks and every drop grows', async ({ context, page }) => {
      await seedLocalBoard(context, withJetztSpent(1800))
      await page.goto('/tasks')
      await expectBar(page, JETZT_ID)

      for (const round of [1, 2, 3]) {
        await test.step(`round ${round}`, async () => {
          await liftFromJetzt(page)
          await dropIntoJetzt(page)
          await expect(chip(page, JETZT_ID)).toHaveClass(/chip--primary/)
        })
      }
    })

    test('timebox: Jetzt -> other column -> Jetzt, then lift and drop in Jetzt again (A -> B -> A -> A)', async ({ context, page }) => {
      await seedLocalBoard(context, withJetztSpent(1800))
      await page.goto('/tasks')
      await expectBar(page, JETZT_ID)

      for (const round of [1, 2]) {
        await test.step(`round ${round}`, async () => {
          // out to Wartet: the preview shrinks, the card lands collapsed
          await liftFromJetzt(page)
          await hover(page, column(page, 'waiting'))
          await page.mouse.up()
          await expect(column(page, 'waiting').locator(`.task[data-task-id="${JETZT_ID}"]`)).toHaveCount(1)
          await expectCollapsed(page, JETZT_ID)

          // back into Jetzt: the card mounts collapsed and grows
          await startRecording(page)
          await drag(page, JETZT_ID, 'progress')
          await expect(column(page, 'progress').locator(`.task[data-task-id="${JETZT_ID}"]`)).toHaveCount(1)
          await expectMotion(page, 'card:chip')
          await expectBar(page, JETZT_ID)

          // lift and drop in Jetzt: still morphs after the column trip
          await liftFromJetzt(page)
          await dropIntoJetzt(page)
        })
      }
    })

    test('no timebox, time spent: the chip shrinks on every lift and grows on every drop into Jetzt', async ({ context, page }) => {
      await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === JETZT_ID ? { ...t, timeBoxSeconds: null, timeSpentSeconds: 900 } : t)))
      await page.goto('/tasks')
      await expect(chip(page, JETZT_ID)).toHaveClass(/chip--now/)

      for (const round of [1, 2, 3]) {
        await test.step(`round ${round}`, async () => {
          await liftFromJetzt(page, { boxless: true })
          await dropIntoJetzt(page, { boxless: true })
        })
      }
    })
  })

  test('a card without a timebox gets a primary spent chip in Jetzt that counts forward', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(t => t.id !== JETZT_ID))
    await page.goto('/tasks')
    await expect(chip(page, 'seed-open-1')).toHaveCount(0)

    await drag(page, 'seed-open-1', 'progress')
    const spent = chip(page, 'seed-open-1')
    await expect(spent).toHaveClass(/chip--boxless/)
    await expect(spent).toHaveClass(/chip--now/)
    await expect(spent).toHaveText('<1 min')
    await expect(spent).not.toHaveAttribute('aria-valuenow', /.*/)
    await expect(spent).toHaveAttribute('aria-label', 'Bisher gearbeitet: <1 min')
  })

  test('a boxless chip turns grey and stays when the card leaves Jetzt with time spent', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === JETZT_ID ? { ...t, timeBoxSeconds: null, timeSpentSeconds: 900 } : t)))
    await page.goto('/tasks')
    await expect(chip(page, JETZT_ID)).toHaveClass(/chip--now/)
    await expect(chip(page, JETZT_ID)).toHaveClass(/chip--boxless/)

    await drag(page, JETZT_ID, 'waiting')
    await expect(column(page, 'waiting').locator(`.task[data-task-id="${JETZT_ID}"]`)).toHaveCount(1)
    await expect(chip(page, JETZT_ID)).toHaveCount(1)
    await expect(chip(page, JETZT_ID)).not.toHaveClass(/chip--now/)
    await expect(chip(page, JETZT_ID)).toHaveAttribute('aria-label', /Bisher gearbeitet: 15/)
  })

  test('Tab never lands on a control hidden under the Jetzt bar', async ({ context, page }) => {
    // Day 3 carry-over dots are a tab stop on every card; under the bar they must not be one
    await seedLocalBoard(context, SEED_TASKS, { [JETZT_ID]: carriedOverDays(2), 'seed-open-1': carriedOverDays(2) })
    await page.goto('/tasks')
    await expectBar(page, JETZT_ID)
    const lead = card(page, JETZT_ID).locator('[data-testid="task-footer-lead"]')
    await expect(lead).toHaveJSProperty('inert', true)
    await expect(card(page, 'seed-open-1').locator('[data-testid="task-footer-lead"]')).toHaveJSProperty('inert', false)

    // Walk the page's tab order: every stop under the Jetzt card is outside its footer start group,
    // and the same dots on an Offen card are reached (the walk really covers the board)
    const stops: string[] = []
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab')
      stops.push(await page.evaluate(() => {
        const el = document.activeElement
        const inJetzt = !!el?.closest('.task[data-current] [data-testid="task-footer-lead"]')
        if (inJetzt) return 'HIDDEN-UNDER-BAR'
        const dots = el?.closest('[data-testid="carry-over-dots"]')
        return dots ? `dots:${dots.closest('.task')?.getAttribute('data-task-id')}` : ''
      }))
    }
    expect(stops).not.toContain('HIDDEN-UNDER-BAR')
    expect(stops).not.toContain(`dots:${JETZT_ID}`)
    expect(stops).toContain('dots:seed-open-1')
  })

  test('the chip never takes pointer events: double click over the bar opens the sheet', async ({ context, page }) => {
    await seedLocalBoard(context, withJetztSpent(1800))
    await page.goto('/tasks')
    await expectBar(page, JETZT_ID)
    await expect(chip(page, JETZT_ID)).toHaveCSS('pointer-events', 'none')
    await chip(page, JETZT_ID).dblclick({ force: true })
    await expect(page).toHaveURL(new RegExp(`/tasks/${JETZT_ID}`))
  })

  test('the footer stays one row with a timebox chip first, dots and a priority badge (#584)', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.map(t => (t.id === 'seed-open-2' ? { ...t, activity: 'Ein sehr langer Aktivitätsname, der nicht auf der Karte steht', priority: 3 } : t)))
    await page.goto('/tasks')
    const footer = card(page, 'seed-open-2').locator('.task-footer')
    const box = (await footer.boundingBox())!
    expect(box.height).toBeLessThan(40)
    const chipBox = (await chip(page, 'seed-open-2').boundingBox())!
    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(box.x + box.width + 1)
    // First item of the footer (#584), and the activity is no badge on the card
    expect(Math.abs(chipBox.x - box.x)).toBeLessThanOrEqual(1)
    await expect(card(page, 'seed-open-2').getByText('Ein sehr langer Aktivitätsname')).toHaveCount(0)
  })

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' })

    test('the final state shows at once: no spring, no fill transition', async ({ context, page }) => {
      await seedLocalBoard(context, SEED_TASKS.filter(t => t.id !== JETZT_ID))
      await page.goto('/tasks')
      await drag(page, 'seed-open-2', 'progress')
      const jetzt = chip(page, 'seed-open-2')
      await expect(jetzt).toHaveClass(/chip--now/)
      await expect(jetzt).toHaveCSS('transition-duration', '0s')
      await expect(jetzt.locator('.chip__fill')).toHaveCSS('transition-duration', '0s')
      expect(await jetzt.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
      await expectBar(page, 'seed-open-2')
    })
  })

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the Jetzt bar spans the footer of the mobile card and stays inside the card', async ({ context, page }) => {
      await seedLocalBoard(context, withJetztSpent(3060))
      await page.goto('/tasks')
      await showColumnPage(page, 1)
      await expectBar(page, JETZT_ID)
      // One read for both rects: the board may still be sliding to the page, and two separate boundingBox() calls would sample different frames
      const { card: cardBox, chip: chipBox } = await card(page, JETZT_ID).evaluate((el, selector) => {
        const c = el.getBoundingClientRect()
        const k = el.querySelector(selector)!.getBoundingClientRect()
        return { card: { x: c.x, width: c.width }, chip: { x: k.x, width: k.width } }
      }, CHIP)
      expect(chipBox.x).toBeGreaterThanOrEqual(cardBox.x)
      expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
      await expect(chip(page, JETZT_ID)).toHaveClass(/chip--warning/)
    })
  })
})
