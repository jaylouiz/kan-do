import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  seedLocalBoard,
  seedMixedBoard,
  seedNotionBoard,
  MIXED_SEED_TASKS,
  SEED_TASKS,
  WORST_CASE_FOOTER_CARRY_OVER,
  WORST_CASE_FOOTER_ID,
  WORST_CASE_FOOTER_TASKS,
  type SeedTask,
} from './helpers/seed'
import { openMore } from './helpers/appNav'
import { openAddSheet } from './helpers/addSheet'

/**
 * Source icon in the card footer (#323). The icon shows iff the board holds tasks from 2+ sources;
 * a one-source board is unchanged. The worst-case footer (timebox chip, source icon and pending cloud, carry-over dots,
 * priority) must stay on one row at 390px. The activity badge left the card in #584.
 */

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`)
const sourceIcon = (scope: Locator | Page) => scope.getByTestId('task-source-icon')

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

/** Notion cannot be reached: its fetch fails, so the seeded Notion tasks stay (the stub would replace them) and the cloud can show. */
const blockNotion = (page: Page) => page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

test.describe('source icon: shown on a mixed board only', () => {
  test('every card of a mixed board has one, in all four columns, named after its source', async ({ context, page }) => {
    await seedMixedBoard(context)
    await page.goto('/tasks')
    await expect(card(page, 'local-open-1')).toBeVisible()

    for (const t of MIXED_SEED_TASKS) {
      const icon = sourceIcon(card(page, t.id))
      await expect(icon, t.id).toHaveCount(1)
      await expect(icon, t.id).toHaveAttribute('aria-label', t.source === 'local' ? 'Lokal' : 'Notion')
    }
    // Erledigt cards included (requirement 4)
    await expect(sourceIcon(page.locator('#column-done-list .task'))).toHaveCount(2)
    // One announcement per card: the icon is no tab stop
    expect(await sourceIcon(page).evaluateAll((els) => els.filter((el) => el.hasAttribute('tabindex')).length)).toBe(0)
  })

  test('a Local-only board shows no icon', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(card(page, SEED_TASKS[0]!.id)).toBeVisible()
    await expect(sourceIcon(page)).toHaveCount(0)
  })

  test('a Notion-only board shows no icon', async ({ context, page }) => {
    await seedNotionBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('.task').first()).toBeVisible()
    await expect(sourceIcon(page)).toHaveCount(0)
  })

  test('a connected but empty second source shows no icon (Notion connected, only Local tasks)', async ({ context, page }) => {
    await seedMixedBoard(context, MIXED_SEED_TASKS.filter((t) => t.source === 'local'))
    await blockNotion(page)
    await page.goto('/tasks')
    await expect(card(page, 'local-open-1')).toBeVisible()
    await expect(sourceIcon(page)).toHaveCount(0)
  })

  test('the add sheet draft card has none', async ({ context, page }) => {
    await seedMixedBoard(context)
    await page.goto('/tasks')
    await expect(card(page, 'local-open-1')).toBeVisible()
    await openAddSheet(page)
    const draft = page.getByTestId('task-draft-card')
    await expect(draft).toBeVisible()
    await expect(sourceIcon(draft)).toHaveCount(0)
  })
})

for (const { name, viewport } of [{ name: '1280px', viewport: DESKTOP }, { name: '390px', viewport: MOBILE }]) {
  test.describe(`worst-case footer at ${name}`, () => {
    test.use({ viewport })

    test('stays on one row, keeps the right group clear and does not grow the card', async ({ context, page, browser }) => {
      await seedMixedBoard(context, WORST_CASE_FOOTER_TASKS, { carryOverByTaskId: WORST_CASE_FOOTER_CARRY_OVER })
      await blockNotion(page)
      await page.goto('/tasks')
      const worst = card(page, WORST_CASE_FOOTER_ID)
      await expect(worst).toBeVisible()
      await expect(worst.getByTestId('task-save-pending')).toBeVisible()
      await expect(sourceIcon(worst)).toBeVisible()
      await expect(worst.getByTestId('carry-over-dots')).toBeVisible()

      // Layout can still settle (fonts, the offline cloud): retry the geometry until it holds
      let cardBox = await box(worst)
      await expect(async () => {
        // Order (#584): the timebox chip, then the source icon, the cloud 4px to its right, then the dots; no activity badge
        const chip = await box(worst.getByTestId('task-progress-chip'))
        const icon = await box(sourceIcon(worst))
        const cloud = await box(worst.getByTestId('task-save-pending'))
        const dots = await box(worst.getByTestId('carry-over-dots'))
        // The chip never shrinks (the dots clip first): its label is not cut off
        const chipClip = await worst.getByTestId('task-progress-chip').evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(chipClip).toBeLessThanOrEqual(1)
        expect(icon.x).toBeGreaterThanOrEqual(chip.x + chip.width - 1)
        expect(cloud.x - (icon.x + icon.width)).toBeCloseTo(4, 0)
        expect(dots.x).toBeGreaterThanOrEqual(cloud.x + cloud.width - 1)
        await expect(worst.locator('[data-slot="footer"]').getByText('Konzeption und Abstimmung')).toHaveCount(0)

        // One row: every footer item is vertically inside the footer row, none below another
        const footer = await box(worst.locator('[data-slot="footer"] .task-footer'))
        const right = await box(worst.locator('[data-slot="footer"] .task-footer > div').last())
        for (const item of [chip, icon, cloud, dots, right]) {
          expect(item.y).toBeGreaterThanOrEqual(footer.y - 1)
          expect(item.y + item.height).toBeLessThanOrEqual(footer.y + footer.height + 1)
        }
        const centres = [chip, icon, cloud, dots].map((b) => b.y + b.height / 2)
        expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(6)
        // Nothing overlaps the right group, nothing leaves the card
        expect(dots.x + dots.width).toBeLessThanOrEqual(right.x + 1)
        cardBox = await box(worst)
        expect(right.x + right.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
        // Single-line footer: the row stays at its 1.75rem minimum (a wrapped item would make it taller)
        expect(footer.height).toBeLessThanOrEqual(29)
      }).toPass()

      // Card height: not larger than the same card on a one-source board (no icon)
      const soloContext = await browser.newContext({ viewport })
      const solo = await soloContext.newPage()
      await seedMixedBoard(soloContext, WORST_CASE_FOOTER_TASKS.filter((t) => t.source === 'notion'), { carryOverByTaskId: WORST_CASE_FOOTER_CARRY_OVER })
      await blockNotion(solo)
      await solo.goto('/tasks')
      const soloCard = card(solo, WORST_CASE_FOOTER_ID)
      await expect(soloCard).toBeVisible()
      await expect(sourceIcon(solo)).toHaveCount(0)
      const soloHeight = (await box(soloCard)).height
      await soloContext.close()
      expect(cardBox.height).toBeLessThanOrEqual(soloHeight + 0.5)
    })

    test('an overflowing footer keeps the chip label whole (the dots clip first)', async ({ context, page }) => {
      // Narrower than the worst-case card needs: the footer overflows and the lead group has to shrink
      await page.setViewportSize({ width: 280, height: 700 })
      await seedMixedBoard(context, WORST_CASE_FOOTER_TASKS, { carryOverByTaskId: WORST_CASE_FOOTER_CARRY_OVER })
      await blockNotion(page)
      await page.goto('/tasks')
      const chip = card(page, WORST_CASE_FOOTER_ID).getByTestId('task-progress-chip')
      await expect(chip).toBeVisible()
      await expect(async () => {
        expect(await chip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
      }).toPass()
    })

    test('the same card inside a stack keeps the footer on one row', async ({ context, page }) => {
      const stacked = WORST_CASE_FOOTER_TASKS.map((t) => ({ ...t, topic: 'Backend' }))
      await seedMixedBoard(context, stacked, { carryOverByTaskId: WORST_CASE_FOOTER_CARRY_OVER, grouping: { enabled: true, key: 'topic' } })
      await blockNotion(page)
      await page.goto('/tasks')
      const stack = page.locator('#column-open-list .task-stack')
      await expect(stack).toBeVisible()
      const front = stack.locator('.task').first()
      await expect(async () => {
        const footer = await box(front.locator('[data-slot="footer"] .task-footer'))
        const right = await box(front.locator('[data-slot="footer"] .task-footer > div').last())
        expect(right.x + right.width).toBeLessThanOrEqual((await box(front)).x + (await box(front)).width + 1)
        const dots = await box(front.getByTestId('carry-over-dots'))
        expect(dots.x + dots.width).toBeLessThanOrEqual(right.x + 1)
        expect(Math.abs(dots.y + dots.height / 2 - (right.y + right.height / 2))).toBeLessThan(8)
        expect(footer.y).toBeLessThanOrEqual(dots.y)
      }).toPass()
    })
  })
}

test.describe('grouping on a mixed board', () => {
  test.use({ viewport: DESKTOP })

  test('same-named topics stack across sources, with the icon', async ({ context, page }) => {
    const tasks = [
      task({ id: 'l1', title: 'Lokal API', status: 0, topic: 'Backend', source: 'local', externalId: null }),
      task({ id: 'n1', title: 'Notion API', status: 0, topic: 'Backend', source: 'notion', externalId: 'n1' }),
    ]
    await seedMixedBoard(context, tasks, { grouping: { enabled: true, key: 'topic' } })
    await blockNotion(page)
    await page.goto('/tasks')
    const stack = page.locator('#column-open-list .task-stack')
    await expect(stack).toHaveCount(1)
    await expect(stack).toHaveAttribute('data-stack-size', '2')
    await expect(sourceIcon(stack)).toHaveCount(2)
  })

  test('the grouping menu offers no custom property; a persisted custom key falls back to topic', async ({ context, page }) => {
    await seedMixedBoard(context, MIXED_SEED_TASKS, {
      grouping: { enabled: true, key: 'custom:bereich' },
      notionConfig: {
        propertyMapping: {
          title: 'Name', status: 'Status', dueDate: null, priority: null, timeBox: 'Timebox', timeSpent: 'Aufwand', timeSpentUnit: 'minutes',
          customProperties: [{ name: 'Bereich', type: 'select', enabled: true, key: 'bereich' }],
        },
      },
    })
    await page.goto('/tasks')
    await expect(card(page, 'local-open-1')).toBeVisible()
    const options = (await openMore(page)).getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveText('Thema')
    await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'true') // the persisted custom key is not offered: the board shows the first option
    await expect(options.nth(1)).toHaveText('Aktivität')
    await expect(options.nth(2)).toHaveText('Priorität')
  })

  test('a Notion-only board keeps its custom property option', async ({ context, page }) => {
    await seedNotionBoard(context, undefined, {
      propertyMapping: {
          title: 'Name', status: 'Status', dueDate: null, priority: null, timeBox: 'Timebox', timeSpent: 'Aufwand', timeSpentUnit: 'minutes',
          customProperties: [{ name: 'Bereich', type: 'select', enabled: true, key: 'bereich' }],
      },
    })
    await page.goto('/tasks')
    await expect(page.locator('.task').first()).toBeVisible()
    const panel = await openMore(page)
    await panel.getByRole('switch', { name: /Karten stapeln/ }).click()
    await expect(panel.getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')).toHaveCount(4)
  })
})
