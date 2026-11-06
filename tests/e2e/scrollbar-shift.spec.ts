/**
 * E2E: no layout shift from the document scrollbar (issue #580). An open overlay (card context menu,
 * command palette, dialog, task sheet) locks the page scroll, which removes a classic scrollbar. Nothing on
 * the page may move horizontally for that: not the board, and not the elements outside the body flow
 * (fixed toasts, the background image, the titlebar): they subtract `--scrollbar-width` (assets/css/utilities.css).
 *
 * Headless Chromium hides scrollbars by default (overlay-like, width 0), which would pass without the fix:
 * this spec launches with classic ones and asserts that the scrollbar is really there first. A macOS host with
 * "Show scroll bars: Automatically" and only a trackpad makes Chromium use overlay scrollbars even then (#612),
 * so the page also gets a `::-webkit-scrollbar` style: a styled scrollbar is always classic and takes width.
 * With a classic bar the page also reserves its gutter (#669, `kando-classic-scrollbar`): the lock then removes nothing
 * and the same zero-shift holds, which is what these cases assert.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, fillerTasks, SEED_TASKS } from './helpers/seed'
import { openDayClose } from './helpers/appNav'
import { forceClassicScrollbar, tagElements, boxes, moved, documentScrollbar } from './helpers/layoutShift'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const openers: Array<{ name: string, open: (page: Page) => Promise<void> }> = [
  {
    name: 'card context menu',
    open: async (page) => {
      await page.locator('.task-wrapper').first().click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
    },
  },
  {
    name: 'command palette',
    open: async (page) => {
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible()
    },
  },
  {
    name: 'dialog',
    open: async (page) => {
      await openDayClose(page)
      await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeVisible()
    },
  },
  {
    name: 'task sheet',
    open: async (page) => {
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
]

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(30, 0)])
})

for (const viewport of [{ name: 'desktop', width: 1280, height: 700 }, { name: 'wide', width: 1800, height: 700 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const { name, open } of openers) {
      test(`${name} moves no element horizontally`, async ({ page }) => {
        await forceClassicScrollbar(page)
        await page.goto('/tasks')
        await expect(page.locator('.task-wrapper').first()).toBeVisible()
        // The precondition: a classic scrollbar takes width from the page (not on touch layouts, where the board scrolls inside)
                if (viewport.width > 767) await expect.poll(() => documentScrollbar(page), { message: 'the document has a classic scrollbar' }).toBeGreaterThan(0)
        await tagElements(page)
        const before = await boxes(page)

        await open(page)
        const afterOpen = await boxes(page)
        expect(moved(before, afterOpen)).toEqual([])

        await page.keyboard.press('Escape')
        // The lock is released when `--scrollbar-width` is gone again; the menu and dialogs fade out first
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--scrollbar-width'))).toBe('')
        await expect.poll(async () => moved(before, await boxes(page))).toEqual([])
      })
    }
  })
}
