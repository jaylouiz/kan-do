import { test, expect } from '@playwright/test';
import { seedLocalBoard, seedNewDayBoard } from './helpers/seed';
import { openDayClose } from './helpers/appNav';

test.describe('Modal Style Validation', () => {
  test.beforeEach(async ({ context }) => {
    // Empty Local board, seeded before page JS runs (no goto + evaluate + reload, #512).
    await seedLocalBoard(context, []);
  });

  test('sheet background is elevated', async ({ page }) => {
    // Navigate to add task to open the modal
    await page.goto('/tasks/add');
    
    // Locate the modal content (TaskSheet)
    const modalCard = page.getByRole('dialog');
    await expect(modalCard).toBeVisible();
    
    // Check computed background color of the modal card
    const dialogBg = await modalCard.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    
    // The sheet uses bg-elevated: every lifted surface is the white sheet (DESIGN.md "Colour")
    expect(dialogBg).toBe('rgb(255, 255, 255)');
  });

  // kd#179: every dialog title is the subhead role, from the theme alone (DESIGN.md "Type")
  for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    test.describe(`dialog titles at ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      const expectSubhead = async (title: import('@playwright/test').Locator) => {
        await expect(title).toBeVisible();
        const style = await title.evaluate((el) => {
          // The innermost element that holds the words: a call site's own span must not hide behind the theme's slot
          let inner: Element = el;
          while (inner.firstElementChild && inner.firstElementChild.textContent?.trim()) inner = inner.firstElementChild;
          const s = getComputedStyle(inner);
          return { size: s.fontSize, family: s.fontFamily };
        });
        expect(style.size).toBe('18px');
        expect(style.family).toContain('Fraunces');
      };

      test('the add-task sheet and the end-of-day dialog share it', async ({ page }) => {
        await page.goto('/tasks/add');
        await expectSubhead(page.getByRole('dialog').locator('[data-slot="title"]'));
        await page.goto('/tasks');
        await openDayClose(page);
        await expectSubhead(page.getByRole('dialog').locator('[data-slot="title"]'));
      });

      test('the new-day recap is no exception', async ({ page, context }) => {
        await seedNewDayBoard(context);
        await page.goto('/tasks');
        await expectSubhead(page.getByRole('dialog').locator('[data-slot="title"]'));
      });
    });
  }
});
