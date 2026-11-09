import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DEFAULT_NOTION_SEED_CONFIG, seedLocalBoard, seedMixedBoard, seedNotionBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { openAddSheet } from './helpers/addSheet'
import { settleAnimations } from './helpers/settle'
import { expectContrast } from './helpers/contrast'

/**
 * #649: the Offen add button turns the slot into a card that takes the title, then asks Thema, Aktivität, Timebox
 * and Notiz one after another and saves at the end. No sheet, no route change.
 */

const offen = (page: Page) => page.locator('#column-open')
const card = (page: Page) => page.getByTestId('new-card-flow')
const title = (page: Page) => page.getByTestId('new-card-title')
const step = (page: Page) => page.getByTestId('new-card-step')
const addButton = (page: Page) => offen(page).locator('.add-task-button')
const box = async (locator: Locator) => (await locator.boundingBox())!

/** More than three topics and activities, so the Mehr list has something behind the three pills (kd#16) */
const RICH_TASKS: SeedTask[] = [
  ...SEED_TASKS,
  ...['Marketing:Recherche', 'Büro:Abstimmung', 'Vertrieb:Telefonat', 'Finanzen:Auswertung'].map((pair, index): SeedTask => {
    const [topic, activity] = pair.split(':')
    return { ...SEED_TASKS[0]!, id: `rich-${index}`, title: `Reich ${index}`, topic, activity, status: 2 }
  }),
]

const storedTasks = (page: Page) =>
  page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as {
      tasks?: Array<{ id: string; title: string; source: string; topic: string | null; topicColorCode: string | null; activity: string | null; notes: string | null; timeBoxSeconds: number | null; status: number }>
    }
    return raw.tasks ?? []
  })
const storedTask = async (page: Page, taskTitle: string) => (await storedTasks(page)).find((task) => task.title === taskTitle)

async function openCard(page: Page) {
  await addButton(page).click()
  await expect(title(page)).toBeFocused()
}

/** Types a title and confirms it: the first question appears */
async function confirmTitle(page: Page, text: string) {
  await title(page).fill(text)
  await page.keyboard.press('Enter')
  await expect(step(page)).toBeVisible()
}

for (const { name, viewport, touch } of [
  { name: '1280px', viewport: { width: 1280, height: 900 }, touch: false },
  { name: '390px', viewport: { width: 390, height: 844 }, touch: true },
]) {
  test.describe(`guided new card at ${name}`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch })

    test.beforeEach(async ({ context, page }) => {
      await seedLocalBoard(context, RICH_TASKS)
      await page.goto('/tasks')
      await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
    })

    test('title step: the input stands at the title position of a card, the check on the line of the answer rows', async ({ page }) => {
      // Offsets inside the card from one synchronous read: opening the card scrolls the board, so separate reads would drift
      const offsets = () =>
        page.evaluate(() => {
          const rect = (el: Element | null) => el!.getBoundingClientRect()
          const regular = document.querySelector('#column-open .task-wrapper[aria-label="Dokumentation lesen"]')!
          const regularTop = rect(regular.querySelector('.task')).top
          const flowEl = document.querySelector('[data-testid="new-card-flow"]')
          const flowRect = flowEl ? rect(flowEl) : null
          const mid = (el: Element | null) => (el ? rect(el).top + rect(el).height / 2 - flowRect!.top : null)
          return {
            regularTitle: rect(regular.querySelector('.task-title-text')).top - regularTop,
            height: flowRect?.height ?? null,
            input: el(flowEl, '[data-testid="new-card-title"]') ? rect(el(flowEl, '[data-testid="new-card-title"]')).top - flowRect!.top : null,
            check: mid(el(flowEl, '[data-testid="new-card-confirm-title"]')),
            row: mid(el(flowEl, '[data-testid="new-card-options"]')),
          }
          function el(root: Element | null, selector: string) {
            return root?.querySelector(selector) ?? null
          }
        })

      await openCard(page)
      const title1 = await offsets()
      expect(Math.abs(title1.input! - title1.regularTitle)).toBeLessThanOrEqual(1)
      // The check is centred vertically on the card ...
      expect(Math.abs(title1.check! - title1.height! / 2)).toBeLessThanOrEqual(1)
      await expect(page.getByTestId('new-card-confirm-title')).toBeDisabled()

      // ... and the steps hold the 2x2 answer grid: the card grows by about 20 px (kd#16) and the grid stands inside it
      await confirmTitle(page, 'Angebot schreiben')
      await expect(page.getByTestId('new-card-options')).toBeVisible()
      await settleAnimations(page) // the step slides in over 140 ms: read the boxes at rest (#105)
      const next = await offsets()
      expect(next.height! - title1.height!).toBeGreaterThanOrEqual(10)
      // up to 48: the phone's 44 px answers (#72) make the two rows 8 px taller than the old 40 px ones
      expect(next.height! - title1.height!).toBeLessThanOrEqual(48)
      const grid = await box(page.getByTestId('new-card-options'))
      const flow = await box(card(page))
      expect(grid.y).toBeGreaterThan(flow.y)
      expect(grid.y + grid.height).toBeLessThanOrEqual(flow.y + flow.height)
    })

    test('axe finds nothing on the title step, a choice step and the Notiz step', async ({ page }) => {
      const scan = async () => {
        await page.mouse.move(2, 2) // no hover fill mid-transition
        await settleAnimations(page)
        const { violations } = await new AxeBuilder({ page }).include('[data-testid="new-card-flow"]').analyze()
        return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
      }
      await openCard(page)
      expect(await scan()).toEqual([])
      await confirmTitle(page, 'Barrierefrei')
      await expect(page.getByTestId('new-card-options')).toBeVisible()
      expect(await scan()).toEqual([])
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('new-card-notes')).toBeFocused()
      expect(await scan()).toEqual([])
    })

    test('mouse path: pills, all options and the note; saves in Offen with the toast and the focus on the card', async ({ page }) => {
      await openCard(page)
      await confirmTitle(page, 'Mit der Maus angelegt')

      await expect(step(page)).toHaveAttribute('data-step', 'topic')
      await expect(step(page)).toHaveAccessibleName('Thema?')
      await page.getByTestId('new-card-options').getByRole('button').first().click()
      await expect(step(page)).toHaveAttribute('data-step', 'activity')
      // "Alle Optionen": the list (popover on desktop, drawer at 390 px) has every value; a pick continues
      await page.getByTestId('new-card-more').click()
      await page.getByRole('group', { name: 'Aktivität?' }).last().getByRole('button').last().click()
      await expect(step(page)).toHaveAttribute('data-step', 'timebox')
      await page.getByTestId('new-card-options').getByRole('button', { name: /30 min/ }).click()
      await expect(step(page)).toHaveAttribute('data-step', 'notes')
      await expect(page.getByTestId('new-card-notes')).toBeFocused()
      await page.getByTestId('new-card-notes').fill('Kurz und knapp')
      await page.getByTestId('new-card-save').click()

      await expect(card(page)).toHaveCount(0)
      await expect(page).toHaveURL(/\/tasks$/)
      await expect.poll(async () => (await storedTask(page, 'Mit der Maus angelegt'))?.notes).toBe('Kurz und knapp')
      const saved = (await storedTask(page, 'Mit der Maus angelegt'))!
      expect(saved).toMatchObject({ source: 'local', status: 0, timeBoxSeconds: 1800 })
      expect(saved.topic).toBeTruthy()
      expect(saved.activity).toBeTruthy()
      await expect(page.getByText('Aufgabe hinzugefügt', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Öffne die Aufgabendetails für Änderungen.')).toHaveCount(0) // one row since #665
      await expect(offen(page).locator(`.task-wrapper[data-task-id="${saved.id}"]`)).toBeFocused()
      await page.getByRole('button', { name: 'Details' }).click()
      await expect(page).toHaveURL(new RegExp(`/tasks/${saved.id}$`))
    })

    test('#672: a topic with a colour shows the dot of its siblings on the face and on the saved card', async ({ page }) => {
      const hueOf = (scope: Locator) => scope.getByTestId('topic-mark').first().getAttribute('data-hue')
      const sibling = offen(page).locator('.task-wrapper[data-task-id="seed-open-1"]') // topic "Design", colour #6366f1
      const siblingHue = await hueOf(sibling)
      expect(siblingHue).toBeTruthy()

      await openCard(page)
      await confirmTitle(page, 'Mit Farbpunkt')
      // Design is a pill; typing part of its name into Mehr and Enter picks that very value, never creates "des" (kd#16)
      await page.getByTestId('new-card-more').click()
      await page.getByTestId('new-card-search').fill('des')
      await page.keyboard.press('Enter')
      await expect(step(page)).toHaveAttribute('data-step', 'activity')
      await expect(card(page).getByTestId('topic-mark')).toHaveAttribute('data-hue', siblingHue!)

      await page.keyboard.press('Enter') // skip Aktivität
      await page.keyboard.press('Enter') // skip Timebox
      await page.keyboard.press('Enter') // empty note saves
      await expect(card(page)).toHaveCount(0)
      await expect.poll(async () => (await storedTask(page, 'Mit Farbpunkt'))?.topic).toBe('Design')
      const saved = (await storedTask(page, 'Mit Farbpunkt'))!
      expect(saved).toMatchObject({ topicColorCode: '#6366f1' })
      await expect(offen(page).locator(`.task-wrapper[data-task-id="${saved.id}"]`).getByTestId('topic-mark')).toHaveAttribute('data-hue', siblingHue!)
    })

    test('cancelling: Esc on the title step, back on the later steps; a press outside throws away a blank card only', async ({ page }) => {
      await openCard(page)
      await page.keyboard.press('Escape')
      await expect(card(page)).toHaveCount(0)
      await expect(addButton(page)).toBeFocused()

      // a blank card: a press outside cancels it
      await openCard(page)
      await page.locator('body').click({ position: { x: 4, y: 4 } })
      await expect(card(page)).toHaveCount(0)

      // a card with a title stays on a press outside
      await openCard(page)
      await title(page).fill('Bleibt stehen')
      await page.locator('body').click({ position: { x: 4, y: 4 } })
      await expect(card(page)).toBeVisible()
      await expect(title(page)).toHaveValue('Bleibt stehen')

      // Esc steps back from a later step, keeping what was typed; a second Esc cancels from the title step
      await title(page).press('Enter')
      await expect(step(page)).toHaveAttribute('data-step', 'topic')
      await page.keyboard.press('Escape')
      await expect(title(page)).toBeFocused()
      await expect(title(page)).toHaveValue('Bleibt stehen')
      await page.keyboard.press('Escape')
      await expect(card(page)).toHaveCount(0)
      expect(await storedTask(page, 'Bleibt stehen')).toBeUndefined()
    })

    test('#668: going back to the title after a topic leaves the title field clear of the topic row', async ({ page }) => {
      await openCard(page)
      await confirmTitle(page, 'Mit Thema zurück')
      await page.keyboard.press('1') // Thema: its pill
      await expect(step(page)).toHaveAttribute('data-step', 'activity')
      await page.keyboard.press('Escape') // Aktivität → Thema
      await expect(step(page)).toHaveAttribute('data-step', 'topic')
      await page.keyboard.press('Escape') // Thema → title
      await expect(title(page)).toBeFocused()
      await settleAnimations(page)
      const topicRow = await box(card(page).locator('.ncf__face .task-topic'))
      const field = await box(title(page))
      expect(field.y).toBeGreaterThanOrEqual(topicRow.y + topicRow.height - 1)
      // and still inside the card
      const flow = await box(card(page))
      expect(field.y + field.height).toBeLessThanOrEqual(flow.y + flow.height)
    })

    test('#668: a long title with a timebox picked, then back to the title, keeps the field clear of the footer chip', async ({ page }) => {
      // the card clamps a long title (3 lines under a topic with a footer) and stays that tall: the field must not run past it
      await openCard(page)
      await confirmTitle(page, 'Quartalsabschluss vorbereiten Belege sortieren Rückfragen klären Steuerberatung Unterlagen prüfen')
      await page.keyboard.press('1') // Thema
      await expect(step(page)).toHaveAttribute('data-step', 'activity')
      await page.keyboard.press('Enter') // skip Aktivität
      await expect(step(page)).toHaveAttribute('data-step', 'timebox')
      await page.keyboard.press('2') // 30 min: the chip stands in the footer
      await expect(step(page)).toHaveAttribute('data-step', 'notes')
      for (const back of ['timebox', 'activity', 'topic']) {
        await page.keyboard.press('Escape')
        await expect(step(page)).toHaveAttribute('data-step', back)
      }
      await page.keyboard.press('Escape') // Thema → title
      await expect(title(page)).toBeFocused()
      await settleAnimations(page)
      const field = await box(title(page))
      const footer = await box(card(page).locator('.ncf__face .task-footer'))
      expect(field.y + field.height).toBeLessThanOrEqual(footer.y + 1)
      // it is as tall as the title on the face (the card's own clamp), the rest scrolls inside
      const face = await box(card(page).locator('.ncf__face .task-title-text'))
      expect(field.height).toBeLessThanOrEqual(face.height + 1)
    })

    test('#665: a long title grows the field to read it, clear of the check; the longest stays inside the card', async ({ page }) => {
      const long = 'Quartalsabschluss vorbereiten, Belege sortieren und Rückfragen der Steuerberatung klären'
      await openCard(page)
      const field = title(page)
      await field.fill(long)
      await settleAnimations(page)
      // grown to its text: nothing scrolls inside, and it wrapped (a single line would cut it)
      expect(await field.evaluate((el: HTMLTextAreaElement) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
      const f = await box(field)
      expect(f.height).toBeGreaterThan(40)
      const flow = await box(card(page))
      expect(f.y + f.height).toBeLessThanOrEqual(flow.y + flow.height)
      // the text keeps clear of the check
      const check = await box(page.getByTestId('new-card-confirm-title'))
      const textRight = await field.evaluate((el: HTMLTextAreaElement) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight))
      expect(textRight).toBeLessThanOrEqual(check.x)
      // the face's own title is hidden: the field is the only text
      await expect(card(page).locator('.ncf__face .task-title-text')).toHaveCSS('visibility', 'hidden')

      // the 140-character maximum is more than the card has room for: it scrolls inside, never out of the card
      await field.fill(`${long} ${long}`.slice(0, 140))
      await settleAnimations(page)
      const grown = await box(field)
      const flowNow = await box(card(page))
      expect(grown.y + grown.height).toBeLessThanOrEqual(flowNow.y + flowNow.height)
      // Enter (not a line break) confirms
      await field.press('Enter')
      await expect(step(page)).toBeVisible()
    })

    test('#665: Ctrl/Cmd+Enter saves at once from the title step and from a later step', async ({ page }) => {
      await openCard(page)
      await title(page).fill('Sofort gespeichert')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(card(page)).toHaveCount(0)
      await expect.poll(async () => (await storedTask(page, 'Sofort gespeichert'))?.status).toBe(0)

      await openCard(page)
      await confirmTitle(page, 'Von Thema aus gespeichert')
      await page.keyboard.press('1')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(card(page)).toHaveCount(0)
      await expect.poll(async () => (await storedTask(page, 'Von Thema aus gespeichert'))?.topic).toBeTruthy()
    })

    test('#665: Esc on a typed title gives it back with "Rückgängig"; a blank card closes silently', async ({ page }) => {
      await openCard(page)
      await page.keyboard.press('Escape')
      await expect(card(page)).toHaveCount(0)
      await expect(page.getByText('Entwurf gelöscht')).toHaveCount(0)

      await openCard(page)
      await title(page).fill('Fast verloren')
      await page.keyboard.press('Escape')
      await expect(card(page)).toHaveCount(0)
      await expect(page.getByText('Entwurf gelöscht').first()).toBeVisible()
      await page.getByRole('button', { name: 'Rückgängig' }).click()
      await expect(card(page)).toBeVisible()
      await expect(title(page)).toHaveValue('Fast verloren')
      await expect(title(page)).toBeFocused()
    })

    test('the sheet taking over cancels the card; a second card cannot be opened', async ({ page }) => {
      await openCard(page)
      await expect(addButton(page)).toHaveJSProperty('inert', true)
      await title(page).fill('Wird verworfen')
      await page.locator('body').click({ position: { x: 4, y: 4 } }) // out of the input; the card has a title, so it stays
      await expect(card(page)).toBeVisible()
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByRole('option', { name: 'Aufgabe hinzufügen' }).click()
      await page.waitForURL(/\/tasks\/add/)
      await expect(card(page)).toHaveCount(0)
      await expect(page.getByTestId('task-draft-card')).toBeVisible()
    })
  })
}

test.describe('guided new card, toast on a short phone', () => {
  // A short phone: the saved card sits in the lower half, where the toast stands (#665)
  test.use({ viewport: { width: 390, height: 640 }, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, RICH_TASKS)
    await page.goto('/tasks')
    await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
  })

  test('#665: the toast after a save stays off the saved card', async ({ page }) => {
    await openCard(page)
    await title(page).fill('Toast mit Abstand')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText('Aufgabe hinzugefügt', { exact: true }).first()).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'Toast mit Abstand'))?.id).toBeTruthy()
    const saved = (await storedTask(page, 'Toast mit Abstand'))!
    const toast = await box(page.locator('[data-state="open"][data-swipe-direction], [role="status"]').filter({ hasText: 'Aufgabe hinzugefügt' }).first())
    const task = await box(offen(page).locator(`.task-wrapper[data-task-id="${saved.id}"]`))
    // one row (title and Details): the description line wrapped it to three at 390 px, 150 px tall
    expect(toast.height).toBeLessThan(80)
    const overlap = Math.min(toast.y + toast.height, task.y + task.height) - Math.max(toast.y, task.y)
    const overlapX = Math.min(toast.x + toast.width, task.x + task.width) - Math.max(toast.x, task.x)
    expect(overlap > 0 && overlapX > 0).toBe(false)
  })
})

test.describe('guided new card, keyboard and steps (desktop)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, RICH_TASKS)
    await page.goto('/tasks')
    await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
  })

  test('keys only: 1, 2, 3, Enter and Esc walk the steps; the face fills in behind the wash', async ({ page }) => {
    await addButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(title(page)).toBeFocused()
    await title(page).fill('Nur mit der Tastatur')
    await page.keyboard.press('Enter')

    // Thema: key 1 picks the first suggestion, the topic row shows on the face behind the wash
    await expect(step(page)).toBeFocused()
    await page.keyboard.press('1')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await expect(card(page).locator('.task-topic')).toBeVisible()
    // Aktivität: key 4 opens Mehr (3 picks the third pill)
    await expect(step(page)).toBeFocused()
    await page.keyboard.press('4')
    await expect(page.getByRole('group', { name: 'Aktivität?' }).last().getByRole('button').first()).toBeVisible()
    await page.keyboard.press('Escape') // closes the list only
    await expect(page.getByRole('group', { name: 'Aktivität?' })).toHaveCount(1) // only the step itself: the list is closed
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Enter') // skip
    // Timebox: key 2 = 30 min -> the chip on the face behind the wash
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
    await page.keyboard.press('2')
    await expect(step(page)).toHaveAttribute('data-step', 'notes')
    await expect(page.getByTestId('new-card-notes')).toBeFocused()
    await page.keyboard.press('Escape') // back to Timebox
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
    await page.keyboard.press('Enter') // skip again, Notiz
    await page.keyboard.press('Enter') // empty note saves

    await expect.poll(async () => (await storedTask(page, 'Nur mit der Tastatur'))?.timeBoxSeconds).toBe(1800)
    const saved = (await storedTask(page, 'Nur mit der Tastatur'))!
    expect(saved.notes).toBeNull()
    expect(saved.topic).toBeTruthy()
    expect(saved.activity).toBeNull()
  })

  test('#685: key 4 right after a pick keeps the list open through the slide; closing it hands the focus back to the step', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Liste bleibt offen')
    await page.keyboard.press('1')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('4') // inside the slide: the step's content is not yet (or just) there
    const list = page.getByRole('group', { name: 'Aktivität?' }).last()
    await expect(list.getByRole('button').first()).toBeVisible()
    // the slide's end must not pull the focus out of the list, which would dismiss it
    await expect(page.locator('.ncf-fwd-enter-active, .ncf-fwd-leave-active')).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Aktivität?' })).toHaveCount(2)
    await page.keyboard.press('Escape') // closes the list only
    await expect(page.getByRole('group', { name: 'Aktivität?' })).toHaveCount(1)
    // not on the "all options" button, where Enter would reopen the list
    await expect(step(page)).toBeFocused()
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Enter')
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
  })

  test('#685: a list opened with its button gives the focus back to that button; a pick from a key-opened list moves on', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Liste per Maus')
    await page.keyboard.press('1')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await expect(page.locator('.ncf-fwd-enter-active, .ncf-fwd-leave-active')).toHaveCount(0)
    await page.keyboard.press('4') // opened by key, closed by a pick: leaves no flag behind
    await page.getByRole('group', { name: 'Aktivität?' }).last().getByRole('button').first().click()
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
    await page.keyboard.press('Escape') // back to Aktivität
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await expect(page.locator('.ncf-back-enter-active, .ncf-back-leave-active')).toHaveCount(0)
    await page.getByTestId('new-card-more').click()
    await expect(page.getByRole('group', { name: 'Aktivität?' })).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Aktivität?' })).toHaveCount(1)
    await expect(page.getByTestId('new-card-more')).toBeFocused()
  })

  test('kd#15: arrow keys, Home/End, Enter and Esc work inside the Mehr list; the search field takes the focus first (kd#16)', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Pfeiltasten')
    await page.keyboard.press('1') // Thema -> Aktivität
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('4')
    const search = page.getByTestId('new-card-search')
    const options = page.getByTestId('new-card-more-list').getByRole('button')
    await expect(options.nth(1)).toBeVisible() // at least two values behind the pills
    await expect(search).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(options.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(options.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(options.first()).toBeFocused()
    await page.keyboard.press('ArrowUp') // back to the field
    await expect(search).toBeFocused()
    await page.keyboard.press('ArrowUp') // wraps to the last option
    await expect(options.last()).toBeFocused()
    await page.keyboard.press('ArrowDown') // wraps to the field
    await expect(search).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    await expect(options.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(options.first()).toBeFocused()
    // Esc closes the list and does not also go back a step
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-card-more-list')).toHaveCount(0)
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    // Enter on a focused option picks it and moves on
    await page.keyboard.press('4')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
  })

  test('kd#15: a list opened with the mouse takes the arrows too, and the drawer at 390 px does', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Pfeile per Maus')
    await page.keyboard.press('1')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    const options = page.getByTestId('new-card-more-list').getByRole('button')
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size)
      await page.getByTestId('new-card-more').click()
      await expect(options.nth(1)).toBeVisible()
      await expect(page.getByTestId('new-card-search')).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(options.first()).toBeFocused()
      await page.keyboard.press('End')
      await expect(options.last()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('new-card-more-list')).toHaveCount(0)
    }
  })

  test('kd#16: the search filters the Mehr list, "Neu" creates a value, Home and End stay caret keys in the field', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Neues Thema per Taste')
    await page.keyboard.press('4')
    const search = page.getByTestId('new-card-search')
    await expect(search).toBeFocused()
    const options = page.getByTestId('new-card-more-list').getByRole('button')
    const before = await options.count()
    await search.fill('Fi')
    await expect(options.filter({ hasText: 'Finanzen' })).toHaveCount(1)
    await expect(options).toHaveCount(2) // "Neu: „Fi“" and Finanzen
    await page.keyboard.press('Home') // caret key: the focus stays in the field
    await expect(search).toBeFocused()
    await search.fill('Gartenpflege')
    await expect(page.getByTestId('new-card-new')).toHaveText('Neu: „Gartenpflege“')
    await expect(options).toHaveCount(1)
    expect(before).toBeGreaterThan(1)
    await page.keyboard.press('Enter')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await expect(card(page).locator('.task-topic')).toContainText('Gartenpflege')
    await page.keyboard.press('Enter') // skip Aktivität
    await page.keyboard.press('Enter') // skip Timebox
    await page.keyboard.press('Enter') // empty note saves
    await expect(card(page)).toHaveCount(0)
    await expect.poll(async () => (await storedTask(page, 'Neues Thema per Taste'))?.topic).toBe('Gartenpflege')
  })

  test('kd#16: the Mehr cell and the value pills keep the text contrast over the wash', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Kontrast')
    await settleAnimations(page)
    await page.mouse.move(2, 2)
    await expectContrast(page, page.getByTestId('new-card-more').locator('.truncate'), 4.5)
    await expectContrast(page, page.getByTestId('new-card-options').locator('button.ncf__pill:not(.ncf__pill--more) .truncate').first(), 4.5)
  })

  test('kd#16: no match shows a status line, an exact name picks the existing value and offers no "Neu"', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Suche ohne Treffer')
    await page.getByTestId('new-card-more').click()
    const search = page.getByTestId('new-card-search')
    await search.fill('BÜRO')
    await expect(page.getByTestId('new-card-new')).toHaveCount(0)
    await search.fill('Büro')
    await expect(page.getByTestId('new-card-new')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await storedTask(page, 'Suche ohne Treffer'))?.topic).toBe('Büro')
  })

  test('the key cues sit inside the buttons; every control has a name; the panel is named by its question', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Cues')
    const pills = page.getByTestId('new-card-options').getByRole('button')
    await expect(pills.nth(0)).toHaveAttribute('aria-keyshortcuts', '1')
    await expect(pills.nth(1)).toHaveAttribute('aria-keyshortcuts', '2')
    await expect(pills.nth(2)).toHaveAttribute('aria-keyshortcuts', '3')
    await expect(pills.nth(0).locator('kbd')).toHaveAttribute('data-key', '1')
    await expect(page.getByRole('button', { name: 'Zurück' })).toHaveAttribute('aria-keyshortcuts', 'Escape')
    await expect(page.getByRole('button', { name: 'Überspringen' })).toBeVisible()
    await expect(page.getByTestId('new-card-more')).toHaveAttribute('aria-keyshortcuts', '4')
    await expect(page.getByTestId('new-card-more')).toHaveText('Mehr')
  })

  test('the face behind the step shows only what the card shows: the title is not readable through the wash', async ({ page }) => {
    await openCard(page)
    await confirmTitle(page, 'Hinter dem Schleier')
    const faceTitle = card(page).locator('.task-title-text')
    await expect(faceTitle).toHaveText('Hinter dem Schleier')
    await expect(faceTitle).toHaveCSS('opacity', '0.45')
    await expect(card(page).locator('.ncf__face')).toHaveAttribute('aria-hidden', 'true')
    // the face is not part of the tab order
    await expect(card(page).locator('.ncf__face')).toHaveJSProperty('inert', true)
  })

  test('reduced motion: the slide and the wash are instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openCard(page)
    await confirmTitle(page, 'Ohne Bewegung')
    await expect(card(page).locator('.ncf__veil')).toHaveCSS('transition-duration', '0s')
    await expect(card(page)).toHaveCSS('animation-name', 'none')
  })
})

test.describe('guided new card, steps without values', () => {
  test('a board without topics and activities starts at Timebox and offers no third pill', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await page.goto('/tasks')
    await openCard(page)
    await confirmTitle(page, 'Erste Aufgabe')
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
    await expect(page.getByTestId('new-card-options').getByRole('button')).toHaveCount(3)
    await page.keyboard.press('1')
    await expect(page.getByTestId('new-card-notes')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await storedTask(page, 'Erste Aufgabe'))?.timeBoxSeconds).toBe(900)
  })
})

test.describe('guided new card on a mixed board', () => {
  test('saves in the default source, and the card behind carries no source icon', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local' })
    await page.goto('/tasks')
    await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
    await openCard(page)
    await confirmTitle(page, 'Lokal angelegt')
    await expect(card(page).locator('[data-testid="task-source-icon"], .task-source-icon')).toHaveCount(0)
    // the mixed board has no topics or activities, so Timebox comes first
    await expect(step(page)).toHaveAttribute('data-step', 'timebox')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await storedTask(page, 'Lokal angelegt'))?.source).toBe('local')
    // the sheet with the "Speichern in" switch stays one palette entry away
    await openAddSheet(page)
  })
})

test.describe('guided new card: a new value from the Mehr list (kd#16)', () => {
  test('at 390 px the drawer takes the typed value by tap and the card saves it', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await seedLocalBoard(context, RICH_TASKS)
    await page.goto('/tasks')
    await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
    await openCard(page)
    await confirmTitle(page, 'Neues Thema am Telefon')
    await page.getByTestId('new-card-more').tap()
    const search = page.getByTestId('new-card-search')
    await expect(search).toBeFocused()
    await search.fill('Gartenpflege')
    await page.getByTestId('new-card-new').tap()
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await storedTask(page, 'Neues Thema am Telefon'))?.topic).toBe('Gartenpflege')
    await context.close()
  })

  test('on a Notion board the typed value is written cleaned: commas become spaces', async ({ context, page }) => {
    await seedNotionBoard(context, SEED_TASKS, {
      propertyMapping: { ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping, topic: 'Thema', activity: 'Aktivität' },
    })
    await page.goto('/tasks')
    await expect(offen(page).locator('.task-wrapper').first()).toBeVisible()
    await openCard(page)
    await confirmTitle(page, 'Neues Thema in Notion')
    await page.getByTestId('new-card-more').click()
    await page.getByTestId('new-card-search').fill('Garten, Pflege')
    await expect(page.getByTestId('new-card-new')).toHaveText('Neu: „Garten Pflege“')
    const created = page.waitForRequest((request) => request.url().includes('/api/notion/create-task') && request.method() === 'POST')
    await page.keyboard.press('Enter')
    await expect(step(page)).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const properties = (await created).postDataJSON().properties
    expect(JSON.stringify(properties.Thema)).toContain('Garten Pflege')
    await expect.poll(async () => (await storedTask(page, 'Neues Thema in Notion'))?.topic).toBe('Garten Pflege')
  })
})

test.describe('the other entries keep the sheet', () => {
  test('Jetzt add-and-start still opens the sheet', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.filter((task) => task.status !== 1))
    await page.goto('/tasks')
    await page.locator('#column-progress h2').hover()
    await page.locator('#column-progress .add-task-button').click()
    await page.waitForURL(/\/tasks\/add\?mode=adhoc/)
    await expect(card(page)).toHaveCount(0)
  })
})
