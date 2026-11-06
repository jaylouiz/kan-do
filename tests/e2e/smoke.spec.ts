import { test, expect } from '@playwright/test'

// Minimal E2E smoke: app boots and an unseeded browser lands on the welcome page.
// Uses dev server via webServer setting in playwright.config.ts
// A fresh context has no sources, so `/` renders the board for a moment and then redirects to /welcome (#546: the
// former wait for network silence hid that redirect). The board itself is rendered by every other spec.

test('app boots and shows the welcome page for a browser without sources', async ({ page, baseURL }) => {
  await page.goto(baseURL!)

  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByRole('heading', { level: 1, name: 'Wo sind deine Aufgaben heute?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Notion/i })).toBeVisible()
})
