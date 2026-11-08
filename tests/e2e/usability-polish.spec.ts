import { test, expect } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'

/**
 * Usability polish batch (#27): the sheet title cannot be emptied silently (U14), floating layers do not scale or
 * fade under reduced motion (U12), the Fokus switch has a 44 px hit area on phone (U16). The undo shortcut and the
 * pending delete in the trash (U10, U11) live in trash.spec.ts, the carry-over tab stop (U13) in carry-over.spec.ts.
 */

test.describe('empty sheet title (U14)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS)
  })

  test('Enter on an empty title keeps the editor open with a message; Escape restores the title', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    const header = page.getByTestId('task-detail-header')
    await header.getByRole('button', { name: /^Titel:/ }).click()
    const input = header.getByRole('textbox')
    await input.fill('')
    await page.keyboard.press('Enter')
    await expect(header.getByTestId('inline-required-error')).toHaveText('Gib der Aufgabe einen Titel.')
    await expect(header.getByRole('alert')).toBeVisible()
    await expect(input).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(header.getByTestId('inline-required-error')).toHaveCount(0)
    await expect(header.getByRole('button', { name: 'Titel: Konzept ausarbeiten' })).toBeVisible()
  })

  test('typing again clears the message and a real title saves', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    const header = page.getByTestId('task-detail-header')
    await header.getByRole('button', { name: /^Titel:/ }).click()
    await header.getByRole('textbox').fill('')
    await page.keyboard.press('Enter')
    await expect(header.getByTestId('inline-required-error')).toBeVisible()
    await page.keyboard.type('Neuer Titel')
    await expect(header.getByTestId('inline-required-error')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(header.getByRole('button', { name: 'Titel: Neuer Titel' })).toBeVisible()
  })
})

test.describe('reduced motion (U12)', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the command palette opens without a scale or fade animation', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS)
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    const dialog = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(dialog).toBeVisible()
    const names = await dialog.evaluate(el => getComputedStyle(el).animationName)
    expect(names).toBe('none')
  })
})

test.describe('Fokus switch (U16)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('a 44 px hit area around the 36x20 switch on phone', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS)
    await page.goto('/settings')
    const toggle = page.getByTestId('focus-switch')
    await expect(toggle).toBeVisible()
    const area = await toggle.evaluate((el) => {
      const after = getComputedStyle(el, '::after')
      return { w: parseFloat(after.width), h: parseFloat(after.height) }
    })
    expect(area.h).toBeGreaterThanOrEqual(44)
    expect(area.w).toBeGreaterThanOrEqual(44)
  })
})
