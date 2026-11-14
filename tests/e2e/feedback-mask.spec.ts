import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'

/**
 * #704: activity and topic labels on board cards, and the stack pills that name them when the board is grouped,
 * are task content (CLAUDE.md: `data-private`). Under the capture mask (`html.kando-capture-mask`, ADR 014) no glyph
 * of them may stay visible. Checked on the live DOM that the native snapshot paints: every rendered text node whose
 * text contains a seeded title, topic or activity must have a transparent fill.
 */

const PRIVATE_SEED: SeedTask[] = [
  { id: 'mask-1', title: 'Konzept ausarbeiten', status: 0, priority: 2, activity: 'Lebenslauf aktualisieren', topic: 'Issue delivery', topicColorCode: '#6366f1', timeSpentSeconds: 0, timeBoxSeconds: 1800, custom: {} },
  { id: 'mask-2', title: 'Rechnung schreiben', status: 0, priority: 2, activity: 'Lebenslauf aktualisieren', topic: 'Issue delivery', topicColorCode: '#6366f1', timeSpentSeconds: 0, timeBoxSeconds: null, custom: {} },
  { id: 'mask-3', title: 'Angebot prüfen', status: 2, priority: 1, activity: 'Nachricht/E-Mail schreiben', topic: 'Kundenprojekt', topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: 900, custom: {} },
  { id: 'mask-4', title: 'Bericht senden', status: 3, priority: 1, activity: 'Nachricht/E-Mail schreiben', topic: 'Kundenprojekt', topicColorCode: null, timeSpentSeconds: 600, timeBoxSeconds: 1800, custom: {}, completedAt: new Date().toISOString() },
]
const PRIVATE_WORDS = [...new Set(PRIVATE_SEED.flatMap(task => [task.title, task.activity, task.topic]))]
  .filter((word): word is string => !!word)

/** Rendered text nodes on the board that contain one of `words` and still paint a glyph with the mask class set. */
async function visiblePrivateText(page: Page, words: string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const root = document.documentElement
    root.classList.add('kando-capture-mask')
    try {
      const transparent = (value: string) => value === 'transparent' || /rgba\(.*,\s*0\)$/.test(value)
      const leaks: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? ''
        if (!text || !list.some(word => text.includes(word))) continue
        const el = node.parentElement
        if (!el || el.closest('.sr-only')) continue
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        if (!box.width || !box.height || style.visibility === 'hidden') continue
        if (!transparent(style.webkitTextFillColor || style.color)) leaks.push(`${text} <${el.tagName.toLowerCase()}.${el.className}>`)
      }
      return leaks
    }
    finally {
      root.classList.remove('kando-capture-mask')
    }
  }, words)
}

test.describe('Feedback screenshot mask covers activity and topic labels (#704)', () => {
  for (const grouping of [null, 'activity', 'topic'] as const) {
    test(`no title, topic or activity stays readable under the mask (${grouping ?? 'no grouping'})`, async ({ context, page }) => {
      await seedLocalBoard(context, PRIVATE_SEED, {}, grouping ? { enabled: true, key: grouping } : undefined)
      await installTauriStub(context)
      await page.goto('/tasks')
      await expect(page.locator('main .task').first()).toBeVisible()
      // The labels are really on the board: a seed or layout change must not make this pass with nothing to check
      const shown = await page.locator('main').innerText()
      expect(shown).toContain(grouping === 'activity' ? 'Lebenslauf aktualisieren' : 'Issue delivery')
      expect(await visiblePrivateText(page, PRIVATE_WORDS)).toEqual([])
    })
  }

  test('the open task sheet shows activity and topic only under the mask', async ({ context, page }) => {
    await seedLocalBoard(context, PRIVATE_SEED)
    await installTauriStub(context)
    await page.goto('/tasks/mask-1')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Lebenslauf aktualisieren')
    await expect(sheet).toContainText('Issue delivery')
    const leaks = await visiblePrivateText(page, ['Lebenslauf aktualisieren', 'Issue delivery'])
    expect(leaks).toEqual([])
  })

  // #254: the palette's card group names the focused card ("Verschieben: {title}"), so the heading is task text too
  test('the command palette heading that names the card is masked, the app headings stay readable', async ({ context, page }) => {
    await seedLocalBoard(context, PRIVATE_SEED)
    await installTauriStub(context)
    await page.goto('/tasks')
    await page.locator('.task-wrapper', { hasText: 'Konzept ausarbeiten' }).first().focus()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette).toBeVisible()
    // The heading is really there: a copy or layout change must not make this pass with nothing to check
    await expect(palette.getByText('Verschieben: Konzept ausarbeiten')).toBeVisible()
    expect(await visiblePrivateText(page, ['Konzept ausarbeiten'])).toEqual([])
    // Only task text is masked: an app heading keeps its glyphs under the mask
    expect(await visiblePrivateText(page, ['Aktionen'])).not.toEqual([])
  })
})
