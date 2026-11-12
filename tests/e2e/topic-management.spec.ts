import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  seedLocalBoard,
  seedTopicStyles,
  seedTrash,
  trashTask,
  type SeedTask,
} from './helpers/seed'

/**
 * Topic and activity management (#430) and the topic mark (#431): rename from the settings page and from the
 * picker pencil, merge, the Notion gate, unused options, colour and symbol, persistence. Every test is a sequence
 * (rename A -> B -> A, rename onto an existing name, reload mid-state, the nested drawer closing under an edit),
 * because the bugs to catch are paths that update only one store. Reads of stored state retry (`expect.poll`).
 */

const NOW = new Date().toISOString()

const base = (task: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, topic: null, topicColorCode: null, ...task,
})

const TASKS: SeedTask[] = [
  base({ id: 'tm-open', title: 'Aufgabe offen', status: 0, topic: 'Wrk', activity: 'Plan' }),
  base({ id: 'tm-now', title: 'Aufgabe jetzt', status: 1, topic: 'Wrk' }),
  base({ id: 'tm-wait', title: 'Aufgabe wartet', status: 2, topic: 'Wrk' }),
  base({ id: 'tm-done', title: 'Aufgabe erledigt', status: 3, topic: 'Wrk', completedAt: NOW }),
  base({ id: 'tm-home', title: 'Aufgabe zuhause', status: 0, topic: 'Home' }),
  base({ id: 'tm-plain', title: 'Aufgabe ohne Thema', status: 0 }),
]

/** A Notion-owned topic on a board that never fetches: the stub has no topic property to keep it. */
const NOTION_TASK = base({ id: 'tm-notion', title: 'Aufgabe aus Notion', status: 0, source: 'notion', externalId: 'tm-notion', topic: 'Backend', topicColorCode: 'blue' })

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
] as const

const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`)
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown, key)
const storedTopics = (page: Page) =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('tasks-store') ?? '{"tasks":[]}') as { tasks: Array<{ id: string, topic: string | null }> }).tasks).map(t => [t.id, t.topic]))
const row = (page: Page, name: string) => page.getByTestId('topics-row').filter({ hasText: name })
const editor = (page: Page) => page.getByTestId('topic-editor')

async function seedStatistics(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tm-stats')) return
    sessionStorage.setItem('tm-stats', '1')
    localStorage.setItem('taskStatistics', JSON.stringify({
      completionRecords: [{ taskId: 'tm-done', title: 'Aufgabe erledigt', completedAt: new Date().toISOString(), timeBoxSeconds: 3600, actualTimeSpentSeconds: 3000, estimationAccuracy: 83, topic: 'Wrk', topicColorCode: null, activity: 'Plan', isUnplanned: false }],
    }))
  })
}

type PickerKind = 'topic' | 'activity'
const pickerTrigger = (page: Page, kind: PickerKind) => page.getByTestId(`task-${kind}-select`)
const pickerContent = (page: Page) => page.locator('[data-reka-popper-content-wrapper]')
const editRow = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} .* bearbeiten$`) })

/** Picker -> "Bearbeiten" -> the name's row (#443): the only way into the editor from the task sheet. */
async function openEditorFromPicker(page: Page, name: string, kind: PickerKind = 'topic') {
  await pickerTrigger(page, kind).click()
  await page.getByTestId(`${kind}-edit-toggle`).click()
  await editRow(page, name).click()
}

async function renameInEditor(page: Page, name: string) {
  await editor(page).getByTestId('topic-name-input').fill(name)
  await editor(page).getByTestId('topic-save').click()
  await expect(editor(page)).toHaveCount(0)
}

for (const vp of VIEWPORTS) {
  test.describe(`topic management at ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch })

    test.beforeEach(async ({ context, page }) => {
      await seedLocalBoard(context, TASKS, {}, undefined, { once: true })
      await seedTrash(context, [{ task: { ...trashTask('tm-trashed', 'Gelöschte Aufgabe'), topic: 'Wrk' } }], { once: true })
      await seedTopicStyles(context, { Wrk: { hue: 'blue' }, Home: { hue: 'red', symbol: 'house' } }, { once: true })
      await seedStatistics(page)
    })

    test('a topics row shows hover feedback (surface wash)', async ({ page }) => {
      test.skip(vp.touch, 'hover needs a pointer')
      await page.goto('/settings/topics')
      const button = row(page, 'Wrk').getByTestId('topics-row-button')
      await expect(button).toBeVisible()
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await button.hover()
      await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })

    test('an action row is one 44 px density and its open editor stays inside the row (kd#180)', async ({ page }) => {
      await page.goto('/settings/topics')
      const rowBox = await row(page, 'Home').getByTestId('topics-row-button').boundingBox()
      // two text lines (name and meta) set the height; no 80 px from a content-box min-height
      expect(rowBox!.height).toBeGreaterThanOrEqual(44)
      expect(rowBox!.height).toBeLessThan(72)
      // a phone opens the editor as a drawer; the inline panel exists from md
      test.skip(vp.touch, 'the inline editor panel is md and wider')
      await row(page, 'Wrk').getByTestId('topics-row-button').click()
      await expect(editor(page)).toBeVisible()
      const rowEl = await row(page, 'Wrk').boundingBox()
      const panel = await editor(page).boundingBox()
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(rowEl!.x + rowEl!.width + 0.5)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })

    test('rename from the settings page reaches every status, the trash, the statistics and survives a reload; A -> B -> A restores', async ({ page }) => {
      await page.goto('/settings/topics')
      await expect(page.getByTestId('topics-list')).toBeVisible()
      await row(page, 'Wrk').getByTestId('topics-row-button').click()
      await expect(editor(page)).toBeVisible()
      await renameInEditor(page, '  Work  ')

      // The list shows the new name only, in its place; focus is back on the row
      await expect(page.getByTestId('topics-list')).toContainText('Work')
      await expect(page.getByTestId('topics-list')).not.toContainText('Wrk')
      await expect(row(page, 'Work').getByTestId('topics-row-button')).toBeFocused()

      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-open', 'Work'], ['tm-now', 'Work'], ['tm-wait', 'Work'], ['tm-done', 'Work']]))
      await expect.poll(async () => ((await stored(page, 'trash-store')) as { entries: Array<{ task: { topic: string } }> }).entries[0]?.task.topic).toBe('Work')
      await expect.poll(async () => ((await stored(page, 'taskStatistics')) as { completionRecords: Array<{ topic: string }> }).completionRecords[0]?.topic).toBe('Work')
      // The style moved with the name
      await expect.poll(async () => (await stored(page, 'topic-styles') as { styles: Record<string, { hue: string }> }).styles.Work?.hue).toBe('blue')

      // Every column of the board shows the new name; the old one is nowhere
      await page.goto('/tasks')
      for (const id of ['tm-open', 'tm-now', 'tm-wait', 'tm-done']) await expect(card(page, id).locator('.task-topic')).toHaveText('Work')
      await expect(page.getByText('Wrk')).toHaveCount(0)

      // ... survives a reload
      await page.reload()
      await expect(card(page, 'tm-open').locator('.task-topic')).toHaveText('Work')

      // A -> B -> A: renaming back restores the original names and style
      await page.goto('/settings/topics')
      await row(page, 'Work').getByTestId('topics-row-button').click()
      await renameInEditor(page, 'Wrk')
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-open', 'Wrk'], ['tm-done', 'Wrk']]))
      await expect.poll(async () => (await stored(page, 'topic-styles') as { styles: Record<string, { hue: string }> }).styles.Wrk?.hue).toBe('blue')
    })

    test('the statistics page shows the new name after a rename', async ({ page }) => {
      await page.goto('/settings/topics')
      await row(page, 'Wrk').getByTestId('topics-row-button').click()
      await renameInEditor(page, 'Work')
      await page.goto('/statistics')
      await expect(page.getByText('Work').first()).toBeVisible()
      await expect(page.getByText('Wrk')).toHaveCount(0)
    })

    test('a rename onto an existing name merges: note, button label, one list entry, the target keeps its style', async ({ page }) => {
      await page.goto('/settings/topics')
      await row(page, 'Wrk').getByTestId('topics-row-button').click()
      await editor(page).getByTestId('topic-name-input').fill('Home')
      await expect(editor(page).getByTestId('topic-merge-note')).toContainText('„Home“ gibt es schon. Beide werden zusammengeführt')
      await expect(editor(page).getByTestId('topic-save')).toHaveText('Zusammenführen')
      await editor(page).getByTestId('topic-save').click()
      await expect(editor(page)).toHaveCount(0)

      await expect(page.getByTestId('topics-row')).toHaveCount(1)
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-open', 'Home'], ['tm-done', 'Home'], ['tm-home', 'Home']]))
      await expect.poll(async () => (await stored(page, 'topic-styles') as { styles: Record<string, { hue: string, symbol: string }> }).styles).toEqual({ Home: { hue: 'red', symbol: 'house' } })
    })

    test('the tablist is named and a keyboard-focused tab shows the focus ring (#557)', async ({ page }) => {
      await page.goto('/settings/topics')
      await expect(page.getByRole('tablist', { name: 'Art' })).toBeVisible()
      // Keyboard focus (not a click) so :focus-visible applies
      await page.getByRole('tab', { name: /Themen/ }).focus()
      await page.keyboard.press('ArrowRight')
      const tab = page.getByRole('tab', { name: /Aktivitäten/ })
      await expect(tab).toBeFocused()
      const ring = () => tab.evaluate((el) => {
        const s = getComputedStyle(el)
        return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor }
      })
      // DESIGN.md "States": Nuxt UI's 3px halo without an offset, on every control.
      await expect.poll(ring).toMatchObject({ style: 'solid', width: '3px', offset: '0px' })
    })

    test('an activity is renamed with the Name only', async ({ page }) => {
      await page.goto('/settings/topics')
      await page.getByRole('tab', { name: /Aktivitäten/ }).click()
      await row(page, 'Plan').getByTestId('topics-row-button').click()
      await expect(editor(page).getByTestId('topic-hue-group')).toHaveCount(0)
      await expect(editor(page).getByTestId('topic-symbol-trigger')).toHaveCount(0)
      await renameInEditor(page, 'Planen')
      // The card no longer shows the activity (#584); it is visible in the task sheet
      await page.goto('/tasks/tm-open')
      await expect(page.getByTestId('task-activity-select')).toContainText('Planen')
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks.find((t: { id: string }) => t.id === 'tm-open').activity)).toBe('Planen')
    })

    test('Save is disabled while nothing changed or the name is empty; Escape and Abbrechen close the editor', async ({ page }) => {
      await page.goto('/settings/topics')
      await row(page, 'Wrk').getByTestId('topics-row-button').click()
      const save = editor(page).getByTestId('topic-save')
      await expect(save).toBeDisabled()
      await editor(page).getByTestId('topic-name-input').fill(' Wrk ')
      await expect(save).toBeDisabled()
      await editor(page).getByTestId('topic-name-input').fill('   ')
      await expect(save).toBeDisabled()
      await editor(page).getByTestId('topic-cancel').click()
      await expect(editor(page)).toHaveCount(0)
      await expect(row(page, 'Wrk').getByTestId('topics-row-button')).toBeFocused()
      expect((await storedTopics(page)).find(([id]) => id === 'tm-open')?.[1]).toBe('Wrk')
    })

    test('an option no task uses is listed as unused and renamable', async ({ page }) => {
      // The option lists are rebuilt from the tasks on load, so an unused option exists within a session: create
      // one in the picker, move the task back, then reach the settings page by navigation (no reload)
      await page.goto('/tasks/tm-open')
      await page.getByTestId('task-topic-select').click()
      await page.getByPlaceholder('Thema suchen…').fill('Reisen')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('task-topic-select')).toContainText('Reisen')
      await page.getByTestId('task-topic-select').click()
      await page.getByPlaceholder('Thema suchen…').fill('Wrk')
      await page.getByRole('option', { name: /Wrk/ }).click()
      await expect(page.getByTestId('task-topic-select')).toContainText('Wrk')
      await page.getByTestId('task-topic-select').click()
      await page.getByPlaceholder('Thema suchen…').fill('')
      await page.getByTestId('topic-manage-link').click()

      await expect(row(page, 'Reisen')).toContainText('ungenutzt')
      await row(page, 'Reisen').getByTestId('topics-row-button').click()
      await expect(editor(page).getByTestId('topic-editor-count')).toContainText('Noch keine Aufgabe nutzt dieses Thema.')
      await renameInEditor(page, 'Urlaub')
      await expect(row(page, 'Urlaub')).toContainText('ungenutzt')
      await expect(page.getByTestId('topics-list')).not.toContainText('Reisen')
    })

    test('the open symbol grid covers neither the count line nor the actions; Escape closes it alone and focus returns to its button (kd#135)', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await openEditorFromPicker(page, 'Home')
      const trigger = editor(page).getByTestId('topic-symbol-trigger')
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      // Focus moves into the grid, on the selected glyph
      await expect(page.getByTestId('topic-symbol-group').getByRole('radio', { checked: true })).toBeFocused()
      // A covered element fails the trial click's hit test
      await editor(page).getByTestId('topic-editor-count').click({ trial: true })
      await editor(page).getByTestId('topic-cancel').click({ trial: true })

      await page.keyboard.press('Escape')
      await expect(page.getByTestId('topic-symbol-group')).toHaveCount(0)
      await expect(editor(page)).toBeVisible()
      await expect(trigger).toBeFocused()

      // A pick by mouse closes the grid and hands focus back too; the next Escape closes the editor
      await trigger.click()
      await page.getByTestId('topic-symbol-briefcase').click()
      await expect(page.getByTestId('topic-symbol-group')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(editor(page)).toHaveCount(0)
    })

    test('colour and symbol: the mark shows on the card and in the sheet, an unstyled topic has none, all survive a reload', async ({ page }) => {
      await page.goto('/settings/topics')
      await row(page, 'Home').getByTestId('topics-row-button').click()
      await editor(page).getByTestId('topic-hue-green').click()
      await editor(page).getByTestId('topic-symbol-trigger').click()
      await page.getByTestId('topic-symbol-rocket-launch').click()
      // Picking closes only the popover: the editor stays open
      await expect(page.getByTestId('topic-symbol-group')).toHaveCount(0)
      await expect(editor(page)).toBeVisible()
      await editor(page).getByTestId('topic-save').click()
      await expect(editor(page)).toHaveCount(0)

      await page.goto('/tasks')
      const mark = card(page, 'tm-home').getByTestId('topic-mark')
      await expect(mark).toHaveAttribute('data-hue', 'green')
      await expect(mark).toHaveAttribute('data-symbol', 'rocket-launch')
      await expect(card(page, 'tm-plain').getByTestId('topic-mark')).toHaveCount(0)

      await page.goto('/tasks/tm-home')
      await expect(page.getByTestId('task-property-row').filter({ hasText: 'Thema' }).getByTestId('topic-mark')).toHaveAttribute('data-hue', 'green')

      await page.reload()
      await expect(page.getByTestId('task-property-row').filter({ hasText: 'Thema' }).getByTestId('topic-mark')).toHaveAttribute('data-symbol', 'rocket-launch')

      // "keine" removes the colour; a symbol alone is a muted glyph
      await page.goto('/settings/topics')
      await row(page, 'Home').getByTestId('topics-row-button').click()
      await editor(page).getByTestId('topic-hue-none').click()
      await editor(page).getByTestId('topic-save').click()
      await expect(editor(page)).toHaveCount(0)
      await expect.poll(async () => (await stored(page, 'topic-styles') as { styles: Record<string, { hue: string | null, symbol: string }> }).styles.Home).toEqual({ hue: null, symbol: 'rocket-launch' })
    })

    test('a picker row opens the editor under the row (inline) or as a nested drawer; a rename keeps the sheet open and updates the task', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      // Home is the first option (alphabetical)
      await openEditorFromPicker(page, 'Home')
      const sheetDialog = page.getByRole('dialog').first()
      await expect(page.getByTestId('topic-editor')).toBeVisible()
      if (vp.touch) {
        // Nested drawer: a second dialog over the sheet, the sheet's top edge still visible above it
        await expect(page.locator('[data-vaul-drawer]')).toHaveCount(2)
        const nested = await page.getByTestId('topic-editor-drawer').boundingBox()
        expect(nested!.y).toBeGreaterThan(40)
      } else {
        await expect(page.getByTestId('topic-editor-inline')).toBeVisible()
      }
      // Home is the first option (alphabetical): rename it, the open task (Wrk) is not touched
      await expect(editor(page).getByTestId('topic-name-input')).toHaveValue('Home')
      await renameInEditor(page, 'Zuhause')
      await expect(page.getByTestId('task-topic-select')).toContainText('Wrk')
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-home', 'Zuhause'], ['tm-open', 'Wrk']]))
      await expect(sheetDialog).toBeVisible()
      await expect(page).toHaveURL(/\/tasks\/tm-open$/)

      // Now the open task's own topic: the sheet shows the new name in place
      await openEditorFromPicker(page, 'Wrk')
      await renameInEditor(page, 'Work')
      await expect(page.getByTestId('task-topic-select')).toContainText('Work')
      await expect(page.getByTestId('task-topic-select')).not.toContainText('Wrk')
      await expect(page).toHaveURL(/\/tasks\/tm-open$/)
      // Focus returns to the row's picker trigger
      await expect(page.getByTestId('task-topic-select')).toBeFocused()
    })

    test('Escape in the editor closes it and leaves the sheet open; focus lands on the Name first', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await openEditorFromPicker(page, 'Wrk')
      await expect(editor(page).getByTestId('topic-name-input')).toBeFocused()
      // The closing picker must not win the focus back later (Reka refocuses the trigger after a tick): wait it out
      await expect.poll(async () => {
        await page.waitForTimeout(100)
        return editor(page).getByTestId('topic-name-input').evaluate((el) => el === document.activeElement)
      }, { timeout: 1500 }).toBe(true)
      await page.keyboard.press('Escape')
      await expect(editor(page)).toHaveCount(0)
      await expect(page).toHaveURL(/\/tasks\/tm-open$/)
      await expect(page.getByTestId('task-topic-select')).toBeVisible()
      await expect(page.getByTestId('task-topic-select')).toBeFocused()
    })

    test('a row does not select its option; clicking the option still does', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await openEditorFromPicker(page, 'Home')
      await editor(page).getByTestId('topic-cancel').click()
      await expect(page.getByTestId('task-topic-select')).toContainText('Wrk')
      await page.getByTestId('task-topic-select').click()
      await page.getByRole('option', { name: /Home/ }).click()
      await expect(page.getByTestId('task-topic-select')).toContainText('Home')
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-open', 'Home']]))
    })

    for (const kind of ['topic', 'activity'] as const) {
      test(`${kind} picker: axe finds nothing in picking mode, edit mode and with the editor open; options carry no control`, async ({ page }) => {
        const axe = async () => {
          // Scoped to the open picker: the page's own triggers under the popover are partly covered (target-size), not this change's concern
          const results = await new AxeBuilder({ page }).include('[data-reka-popper-content-wrapper]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
          expect(results.passes.length + results.violations.length).toBeGreaterThan(0)
          return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
        }
        const name = kind === 'topic' ? 'Home' : 'Plan'
        await page.goto('/tasks/tm-open')

        // Picking: no pencil, no control inside any option, the option's name is just its label
        await pickerTrigger(page, kind).click()
        await expect(page.getByRole('option', { name: new RegExp(`^${name}$`) })).toBeVisible()
        expect(await page.getByRole('option').evaluateAll((els) => els.filter((el) => el.querySelector('button, a, input, select, textarea, [tabindex]')).length)).toBe(0)
        expect(await axe()).toEqual([])

        // Edit mode
        await page.getByTestId(`${kind}-edit-toggle`).click()
        await expect(page.getByTestId(`${kind}-edit-toggle`)).toHaveText('Fertig')
        await expect(editRow(page, name)).toBeVisible()
        expect(await axe()).toEqual([])

        // Editor open (the picker is closed; the page's own triggers are scoped out, the editor's controls are not in the popover)
        await editRow(page, name).click()
        await expect(editor(page)).toBeVisible()
        expect(await new AxeBuilder({ page }).include('[data-testid="topic-editor"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze().then((r) => r.violations.map((v) => v.id))).toEqual([])
      })
    }

    test('Bearbeiten -> Fertig -> Bearbeiten -> Escape -> reopen starts in picking mode; Fertig then a pick sets the value; Escape never closes the sheet', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      const toggle = page.getByTestId('topic-edit-toggle')
      await pickerTrigger(page, 'topic').click()
      await expect(toggle).toHaveText('Bearbeiten')
      await expect(toggle).not.toHaveAttribute('aria-pressed', /.*/)
      await toggle.click()
      await expect(toggle).toHaveText('Fertig')
      // Edit mode: heading and list, no search, no listbox, no manage link, no clear
      await expect(pickerContent(page).getByText('Thema bearbeiten', { exact: true })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Thema bearbeiten' }).getByRole('listitem')).toHaveCount(2)
      await expect(editRow(page, 'Home')).toHaveAccessibleName(/^Home 1 Aufgabe bearbeiten$/)
      await expect(editRow(page, 'Wrk')).toHaveAccessibleName(/^Wrk 4 Aufgaben bearbeiten$/)
      await expect(pickerContent(page).getByRole('combobox')).toHaveCount(0)
      await expect(pickerContent(page).getByRole('listbox')).toHaveCount(0)
      await expect(page.getByTestId('topic-manage-link')).toHaveCount(0)
      await expect(page.getByTestId('task-property-clear')).toHaveCount(0)
      // Focus lands on the first row
      await expect(editRow(page, 'Home')).toBeFocused()

      // Fertig: the same button keeps focus, search and options return, the picker stays open
      await toggle.click()
      await expect(toggle).toHaveText('Bearbeiten')
      await expect(pickerContent(page).getByRole('option', { name: 'Home' })).toBeVisible()
      await expect(pickerContent(page).getByRole('combobox')).toBeVisible()
      // The returning search field must not take the focus a tick after it mounts (its autofocus): wait it out
      await expect(toggle).toBeFocused()
      await expect.poll(async () => {
        await page.waitForTimeout(100)
        return toggle.evaluate((el) => el === document.activeElement)
      }, { timeout: 1500 }).toBe(true)
      await toggle.click()
      await expect(toggle).toHaveText('Fertig')

      // Escape closes the picker only (not the sheet); the next open starts in picking mode
      await page.keyboard.press('Escape')
      await expect(pickerContent(page)).toHaveCount(0)
      await expect(page).toHaveURL(/\/tasks\/tm-open$/)
      await expect(pickerTrigger(page, 'topic')).toBeFocused()
      await pickerTrigger(page, 'topic').click()
      await expect(page.getByTestId('topic-edit-toggle')).toHaveText('Bearbeiten')
      await expect(pickerContent(page).getByRole('option', { name: 'Home' })).toBeVisible()

      // Bearbeiten, Fertig, then pick: the value is set and the picker closes
      await page.getByTestId('topic-edit-toggle').click()
      await page.getByTestId('topic-edit-toggle').click()
      await pickerContent(page).getByRole('option', { name: 'Home' }).click()
      await expect(pickerContent(page)).toHaveCount(0)
      await expect(pickerTrigger(page, 'topic')).toContainText('Home')
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-open', 'Home']]))
    })

    test('closing edit mode by an outside click also resets it', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await pickerTrigger(page, 'topic').click()
      await page.getByTestId('topic-edit-toggle').click()
      await expect(page.getByTestId('topic-edit-toggle')).toHaveText('Fertig')
      await page.getByText('Priorität', { exact: true }).first().click()
      await expect(pickerContent(page)).toHaveCount(0)
      await pickerTrigger(page, 'topic').click()
      await expect(page.getByTestId('topic-edit-toggle')).toHaveText('Bearbeiten')
    })

    test('the editor keeps the focus after a row: edit mode -> row -> editor focused -> 500 ms later still focused -> Escape closes only the editor (topic and activity)', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      for (const [kind, name] of [['topic', 'Wrk'], ['activity', 'Plan']] as const) {
        await openEditorFromPicker(page, name, kind)
        const input = editor(page).getByTestId('topic-name-input')
        await expect(input).toBeFocused()
        await page.waitForTimeout(500)
        await expect(input).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(editor(page)).toHaveCount(0)
        await expect(page).toHaveURL(/\/tasks\/tm-open$/)
        await expect(page.getByRole('dialog').first()).toBeVisible()
        await expect(pickerTrigger(page, kind)).toBeFocused()
      }
    })

    test('keyboard only: Tab to the trigger, Enter, Bearbeiten, first row, type a new name, Enter saves', async ({ page }) => {
      test.skip(vp.touch, 'keyboard path, desktop viewport')
      await page.goto('/tasks/tm-open')
      await pickerTrigger(page, 'topic').focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('topic-edit-toggle')).toBeVisible()
      const search = pickerContent(page).getByRole('combobox')
      await expect(search).toBeFocused()
      // Search -> options are arrow-driven; Tab walks on to the footer buttons
      await page.getByTestId('topic-edit-toggle').focus()
      await page.keyboard.press('Enter')
      await expect(editRow(page, 'Home')).toBeFocused()
      // Tab cycles rows, then Fertig, then the first row again (focus stays in the popover)
      await page.keyboard.press('Tab')
      await expect(editRow(page, 'Wrk')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('topic-edit-toggle')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(editRow(page, 'Home')).toBeFocused()
      await page.keyboard.press('Enter')
      const input = editor(page).getByTestId('topic-name-input')
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('Home')
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.type('Zuhause')
      await page.keyboard.press('Enter')
      await expect(editor(page)).toHaveCount(0)
      await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-home', 'Zuhause'], ['tm-open', 'Wrk']]))
      await expect(pickerTrigger(page, 'topic')).toBeFocused()
    })

    test('open picker, edit mode, a row, editor, close: the picker is usable again, in picking mode', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await openEditorFromPicker(page, 'Home')
      await expect(editor(page)).toBeVisible()
      await expect(page.getByTestId('task-topic-select')).toContainText('Wrk')
      await editor(page).getByTestId('topic-cancel').click()
      await expect(editor(page)).toHaveCount(0)
      await page.getByTestId('task-topic-select').click()
      await expect(page.getByRole('option', { name: /Home/ })).toBeVisible()
      await page.getByRole('option', { name: /Home/ }).click()
      await expect(page.getByTestId('task-topic-select')).toContainText('Home')
    })

    test('the picker ends with a "Themen verwalten" row that opens the settings page', async ({ page }) => {
      await page.goto('/tasks/tm-open')
      await page.getByTestId('task-topic-select').click()
      await page.getByTestId('topic-manage-link').click()
      await expect(page).toHaveURL(/\/settings\/topics$/)
      await expect(page.getByTestId('topics-list')).toBeVisible()
    })

    test('the editor under an edit survives the sheet closing: nothing half-saved, no lock left on the page, the board stays usable', async ({ page }) => {
      await page.goto('/tasks')
      await expect(card(page, 'tm-open')).toBeVisible()
      // The card's handlers attach at mount: repeat the open gesture until the route changes
      await expect(async () => {
        await page.evaluate(() => document.querySelector('.task[data-task-id="tm-open"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
        await expect(page).toHaveURL(/\/tasks\/tm-open$/, { timeout: 1000 })
      }).toPass()
      await openEditorFromPicker(page, 'Wrk')
      await editor(page).getByTestId('topic-name-input').fill('Halb')
      // The route changes under the open editor (browser back): the sheet and the editor unmount mid-edit, no reload
      await page.goBack()
      await expect(page).toHaveURL(/\/tasks$/)
      await expect(editor(page)).toHaveCount(0)
      await expect(page.locator('[data-vaul-drawer], [role="dialog"]')).toHaveCount(0)
      expect((await storedTopics(page)).find(([id]) => id === 'tm-open')?.[1]).toBe('Wrk')
      // Nothing is left locked by a half-closed drawer: the body takes pointer events, a card opens the sheet again
      expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none')
      await page.evaluate(() => document.querySelector('.task[data-task-id="tm-home"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await expect(page).toHaveURL(/\/tasks\/tm-home$/)
      await page.getByTestId('task-topic-select').click()
      await expect(page.getByRole('option', { name: /Wrk/ })).toBeVisible()
    })

    test('the add form shows marks in its topic picker but no edit mode', async ({ page }) => {
      await page.goto('/tasks/add')
      await page.getByTestId('add-task-topic-select').click()
      await expect(page.getByRole('option', { name: /Home/ }).getByTestId('topic-mark')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0)
      await expect(page.getByTestId('topic-edit-toggle')).toHaveCount(0)
    })
  })
}

test.describe('Notion-owned topics', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}px`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch })

      test.beforeEach(async ({ context }) => {
        await seedLocalBoard(context, [...TASKS, NOTION_TASK], {}, undefined, { once: true })
      })

      test('the name is gated, colour and symbol stay editable and local; the mark takes the Notion colour first', async ({ page }) => {
        await page.goto('/tasks')
        // No own choice: the card shows the Notion colour mapped onto the hue
        await expect(card(page, 'tm-notion').getByTestId('topic-mark')).toHaveAttribute('data-hue', 'blue')

        await page.goto('/settings/topics')
        await expect(row(page, 'Backend')).toContainText('aus Notion')
        await row(page, 'Backend').getByTestId('topics-row-button').click()
        const name = editor(page).getByTestId('topic-name-input')
        await expect(name).toBeDisabled()
        await expect(editor(page).getByTestId('topic-name-gate')).toContainText('Der Name kommt aus Notion')
        await expect(name).toHaveAttribute('aria-describedby', /.+/)
        await expect(editor(page).getByTestId('topic-color-hint')).toContainText('Ohne eigene Wahl zeigt Kan-Do die Farbe aus Notion (Blau)')

        await editor(page).getByTestId('topic-hue-red').click()
        await expect(editor(page).getByTestId('topic-color-hint')).toContainText('Gilt nur in Kan-Do, Notion behält Blau')
        await editor(page).getByTestId('topic-save').click()
        await expect(editor(page)).toHaveCount(0)

        // No upstream mark: the task carries no pendingSync and keeps its name; the colour is local
        await expect.poll(async () => (await stored(page, 'topic-styles') as { styles: Record<string, { hue: string }> }).styles.Backend?.hue).toBe('red')
        const task = await page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks as Array<{ id: string, topic: string, pendingSync?: unknown }>).find(t => t.id === 'tm-notion'))
        expect(task?.topic).toBe('Backend')
        expect(task?.pendingSync).toBeUndefined()
        await page.goto('/tasks')
        await expect(card(page, 'tm-notion').getByTestId('topic-mark')).toHaveAttribute('data-hue', 'red')

        // "keine" returns to the source colour
        await page.goto('/settings/topics')
        await row(page, 'Backend').getByTestId('topics-row-button').click()
        await editor(page).getByTestId('topic-hue-none').click()
        await editor(page).getByTestId('topic-save').click()
        await page.goto('/tasks')
        await expect(card(page, 'tm-notion').getByTestId('topic-mark')).toHaveAttribute('data-hue', 'blue')
      })

      test('a Local topic may be merged into a Notion-owned name', async ({ page }) => {
        await page.goto('/settings/topics')
        await row(page, 'Home').getByTestId('topics-row-button').click()
        await editor(page).getByTestId('topic-name-input').fill('Backend')
        await expect(editor(page).getByTestId('topic-save')).toHaveText('Zusammenführen')
        await editor(page).getByTestId('topic-save').click()
        await expect.poll(() => storedTopics(page)).toEqual(expect.arrayContaining([['tm-home', 'Backend'], ['tm-notion', 'Backend']]))
        await expect(row(page, 'Backend')).toContainText('aus Notion')
      })
    })
  }
})

test.describe('empty list', () => {
  test('a task without any topic or activity on the board: the picker has no Bearbeiten, only the create row and the manage link; no empty footer band under the activity picker (#461)', async ({ context, page }) => {
    await seedLocalBoard(context, [base({ id: 'e-1', title: 'Nur Titel', status: 0 })])
    await page.goto('/tasks/e-1')
    await page.getByTestId('task-topic-select').click()
    await expect(page.getByTestId('topic-manage-link')).toBeVisible()
    await expect(page.getByTestId('topic-edit-toggle')).toHaveCount(0)
    await expect(page.getByTestId('task-property-footer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-reka-popper-content-wrapper]')).toHaveCount(0)
    await page.getByTestId('task-activity-select').click()
    await expect(page.getByRole('combobox')).toBeVisible()
    await expect(page.getByTestId('activity-edit-toggle')).toHaveCount(0)
    await expect(page.getByTestId('task-property-footer')).toHaveCount(0)
  })

  test('a board without topics says where they come from', async ({ context, page }) => {
    await seedLocalBoard(context, [base({ id: 'e-1', title: 'Nur Titel', status: 0 })])
    await page.goto('/settings/topics')
    await expect(page.getByTestId('topics-empty')).toHaveText('Noch keine Themen.Themen entstehen, wenn du sie an einer Aufgabe wählst.')
  })
})

test.describe('inherited colour in the topic editor (#144)', () => {
  test('a Local topic whose tasks carry a colour explains "Keine Farbe" next to the coloured mark', async ({ context, page }) => {
    await seedLocalBoard(context, [base({ id: 'ih-1', title: 'Entwurf', status: 0, topic: 'Design', topicColorCode: 'blue' })])
    await page.goto('/tasks/ih-1')
    await openEditorFromPicker(page, 'Design')
    await expect(editor(page).getByTestId('topic-color-hint')).toContainText('Ohne eigene Wahl zeigt Kan-Do die Farbe der Aufgaben (Blau)')
    await editor(page).getByTestId('topic-hue-red').click()
    await expect(editor(page).getByTestId('topic-color-hint')).toHaveCount(0)
  })
})

test.describe('long names in the task sheet select (#154)', () => {
  test('a long topic is cut in the middle in the trigger and in the menu, the full name stays the accessible name', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedLocalBoard(context, [
      base({ id: 'ln-1', title: 'Bewerbung schreiben', status: 0, topic: 'Karriere: Weiterbildung am Institut für angewandte Forschung' }),
      base({ id: 'ln-2', title: 'Zweite', status: 0, topic: 'Karriere: Bewerbung am Institut für angewandte Forschung' }),
    ])
    await page.goto('/tasks/ln-1')
    const trigger = page.getByTestId('task-topic-select')
    await expect(trigger.locator('.middle-ellipsis.is-cut')).toHaveCount(1)
    await expect(trigger).toHaveAccessibleName(/Karriere: Weiterbildung am Institut für angewandte Forschung/)
    await trigger.click()
    await expect(page.getByRole('option').locator('.middle-ellipsis.is-cut').first()).toBeVisible()
  })
})
