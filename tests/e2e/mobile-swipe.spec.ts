import { test, expect, type Page } from '@playwright/test';
import { pinClock, pinnedNow } from './helpers/clock';
import { SEED_TASKS, seedLocalBoard } from './helpers/seed';
import { finger, showColumnPage, activeColumnPage } from './helpers/dnd';

/**
 * Issue #145: at 390px a swipe either switches the column page or scrolls the column,
 * never both. Touches are real CDP touch events (Input.dispatchTouchEvent), so the
 * browser applies touch-action and pointer-cancel semantics like a phone does.
 */
test.describe('Mobile swipe axis lock', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  const openTemplate = SEED_TASKS.find(task => task.status === 0)!;
  const longOpen = Array.from({ length: 14 }, (_, i) => ({ ...openTemplate, id: `swipe-open-${i}`, title: `Swipe ${i}` }));

  const offenScrollTop = (page: Page) => page.locator('#column-open').evaluate(el => el.scrollTop);
  const boardTransform = (page: Page) => page.locator('.board').evaluate(el => getComputedStyle(el).transform);

  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, [...longOpen, ...SEED_TASKS.filter(task => task.status !== 0)]);
    await page.goto('/tasks');
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible();
  });

  test('a horizontal swipe switches the page and does not scroll the column', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    await touch.start(300, 400);
    await touch.moveTo(80, 410, 12);
    await touch.end();

    await expect.poll(() => activeColumnPage(page)).toBe(1);
    expect(await offenScrollTop(page)).toBe(0);
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, -390, 0)');
  });

  test('a horizontal-dominant diagonal swipe does not scroll the column', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    await touch.start(320, 500);
    await touch.moveTo(100, 420, 12);
    await touch.end();

    expect(await offenScrollTop(page)).toBe(0);
    await expect.poll(() => activeColumnPage(page)).toBe(1);
  });

  test('a vertical scroll never switches the page or moves the board', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    await touch.start(200, 600);
    await touch.moveTo(230, 250, 14);
    // Mid-gesture: the board must not be dragged sideways
    expect(await boardTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await touch.end();

    await expect.poll(() => offenScrollTop(page)).toBeGreaterThan(50);
    await expect.poll(() => activeColumnPage(page)).toBe(0);
    expect(await boardTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });

  test('the board follows the finger while swiping and snaps back on a short slow release', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    await touch.start(300, 400);
    await touch.moveTo(240, 400, 6, 40);
    await expect(page.locator('.board.swiping')).toHaveCount(1);
    // 60px of finger movement (live offset, no transition) moves the board by the same amount
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, -60, 0)');
    await touch.end();

    await expect(page.locator('.board.swiping')).toHaveCount(0);
    await expect.poll(() => activeColumnPage(page)).toBe(0);
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });

  test('a swipe past the first page is damped and keeps the tab', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    await touch.start(100, 400);
    await touch.moveTo(300, 400, 8, 30);
    const transform = await boardTransform(page);
    const offset = Number(transform.replace('matrix(', '').split(',')[4]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(100);
    await touch.end();

    await expect.poll(() => activeColumnPage(page)).toBe(0);
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });

  test('showColumnPage reaches the last page with real swipes (the tabs are gone, #470)', async ({ page }) => {
    await showColumnPage(page, 2);
    await expect.poll(() => activeColumnPage(page)).toBe(2);
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, -780, 0)');
  });

  test('a long horizontal drop gesture at the end of a card drag does not switch the page', async ({ context, page }) => {
    const touch = finger(await context.newCDPSession(page), page);
    const card = page.locator('#column-open .task-wrapper').first();
    const box = (await card.boundingBox())!;
    await touch.start(box.x + 40, box.y + box.height / 2);
    // Hold past the 250ms touch activation delay, then drag sideways away from the edge zones
    await page.waitForTimeout(400);
    await expect(page.locator('.board.dragging')).toHaveCount(1);
    await touch.moveTo(box.x + 40 + 150, box.y + box.height / 2 + 120, 12, 20);
    await touch.end();

    await expect(page.locator('.board.dragging')).toHaveCount(0);
    await expect(page.locator('.board.swiping')).toHaveCount(0);
    await expect.poll(() => activeColumnPage(page)).toBe(0);
    await expect.poll(() => boardTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });

  test('the column pages take vertical pan only and contain overscroll', async ({ page }) => {
    for (const selector of ['#column-open', '.column-group-mid', '#column-done']) {
      const styles = await page.locator(selector).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { touchAction: cs.touchAction, overscroll: cs.overscrollBehaviorY };
      });
      expect(styles, selector).toEqual({ touchAction: 'pan-y pinch-zoom', overscroll: 'contain' });
    }
    await expect(page.locator('.board-container')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  });

  test('reduced motion: the page switch is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.board')).toHaveCSS('transition-duration', '0s');
  });
});

/**
 * #488: a spec that pins the clock (`pinClock`) must still move between the phone pages by swipe. A frozen `Date.now()`
 * made Vue skip every listener after the first on the event's path, so a touch on a card never reached the board's
 * swipe handler (see `helpers/clock.ts`). The dayclose seed is used because its first card sits under the finger.
 */
test.describe('Mobile swipe with a pinned clock', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('the swipe helper moves between the pages and the pinned clock keeps running', async ({ page }) => {
    const pinned = await pinClock(page);
    await page.goto('/tasks?seed=dayclose');
    await expect(page.locator('.board')).toBeVisible();

    await showColumnPage(page, 2);
    await showColumnPage(page, 0);
    await expect.poll(() => activeColumnPage(page)).toBe(0);

    // Pinned to the spec's instant (not the real date), and moving on: that is what keeps Vue's listeners alive
    const first = await page.evaluate(() => Date.now());
    expect(new Date(first).toDateString()).toBe(pinnedNow().toDateString());
    expect(first).toBeGreaterThanOrEqual(pinned.getTime());
    await expect.poll(() => page.evaluate(() => Date.now())).toBeGreaterThan(first);
  });
});
