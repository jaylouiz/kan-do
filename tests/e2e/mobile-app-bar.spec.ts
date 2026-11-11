import { test, expect, type Page } from '@playwright/test';
import { fillerTasks, seedLocalBoard, SEED_TASKS } from './helpers/seed';
import { activeColumnPage, finger, pickUp, showColumnPage } from './helpers/dnd';
import { appNav, dayCloseCta, moreButton, openMore } from './helpers/appNav';

/**
 * Issue #470 (ADR 017), replacing the #37/#220 action dock and column tabs: at 390px the app bar floats centred at the
 * bottom (the brand, one pill with the two places, a round ⋯ pill), above the safe-area inset, with >=44px hit areas
 * on every column page, and the pages reserve `--phone-bar-offset` for it. Desktop keeps the bar on top and the
 * Tag-abschließen CTA in the Erledigt column.
 */
/** Gap between the sticky Erledigt CTA and the phone bar: footer padding 1rem + the bar's own 0.75rem air, with slack */
const GAP_ABOVE_BAR_MAX = 36;
const bar = (page: Page) => page.locator('[data-app-nav] .app-nav-pill');

/** Opens the board and waits for a rendered card, so the layout reads below see a settled page. A `?seed=` URL reloads once without the param: wait for that too. */
async function openBoard(page: Page, url = '/tasks') {
  await page.goto(url);
  if (url.includes('seed=')) await expect(page).not.toHaveURL(/seed=/);
  await expect(page.locator('.board .task').first()).toBeVisible();
}

test.describe('Mobile app bar', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context);
  });

  for (const [index, name] of ['Offen', 'Jetzt', 'Erledigt'].entries()) {
    test(`390px: the bar is visible, inside the viewport and >=44px on the ${name} page`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openBoard(page);
      await showColumnPage(page, index as 0 | 1 | 2);

      const controls = [
        appNav(page).getByRole('link', { name: 'Heute' }),
        appNav(page).getByRole('link', { name: 'Statistik' }),
        moreButton(page),
      ];
      for (const control of controls) {
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
      }
      // No column tabs and no dock any more
      await expect(page.locator('.board-mobile-tabs, .mobile-tab, #board-mobile-dock')).toHaveCount(0);
    });
  }

  test('390px: the Gesehen action and sort control are >=44px tall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    for (const locator of [
      page.locator('#column-done .yesterday-note button.yesterday-note__ack').first(),
      page.locator('[data-testid="column-sorting-control"] button').first(),
    ]) {
      const box = (await locator.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('390px: the pills float centred at the bottom; --phone-bar-offset equals the padding the pages reserve', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const pill = (await bar(page).boundingBox())!;
    const more = (await moreButton(page).boundingBox())!;
    // No wordmark on a phone (kd#24): the group starts at the pill
    await expect(page.getByTestId('app-nav-brand')).toBeHidden();
    const left = pill.x;
    const right = 390 - (more.x + more.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2); // the group is centred
    expect(pill.height).toBeCloseTo(52, 0); // 3.25rem
    expect(Math.abs(pill.y - more.y)).toBeLessThanOrEqual(1); // same row
    // The bar sits 0.75rem above the bottom edge (no safe-area inset in the test browser)
    expect(844 - (pill.y + pill.height)).toBeCloseTo(12, 0);
    // A flat white sheet (kd#176): an opaque fill, never transparent
    // Chromium reports the tint as `color(srgb r g b / a)`, other engines as `rgba(r, g, b, a)`: read the alpha from either
    const background = await bar(page).evaluate(el => getComputedStyle(el).backgroundColor);
    const alpha = Number(background.match(/\/\s*([\d.]+)\s*\)$/)?.[1] ?? background.match(/^rgba\(.*,\s*([\d.]+)\)$/)?.[1] ?? 1);
    expect(background).not.toBe('transparent');
    expect(alpha, `background ${background}`).toBeGreaterThan(0.5);
    const offset = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;height:var(--phone-bar-offset);visibility:hidden';
      document.body.append(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    });
    expect(offset).toBeCloseTo(72, 0); // 4.5rem
    const padding = await page.locator('#column-open').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    expect(padding).toBeCloseTo(offset + 12, 0); // + 0.75rem
    // The bar clears the reserved space: it starts at or below the page's bottom padding edge
    expect(pill.y).toBeGreaterThanOrEqual(844 - offset);
  });

  test('390px: cards keep a 1rem side gutter, the Jetzt card is as wide as the others', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const card = (await page.locator('#column-open .task').first().boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(390 - (card.x + card.width)).toBeGreaterThanOrEqual(16 - 0.5);
    // Width cap (#234): 17.5rem = 280px, centred
    expect(card.width).toBeCloseTo(280, 0);
    expect(card.x).toBeCloseTo(390 - (card.x + card.width), 0);
    await showColumnPage(page, 1);
    await page.waitForTimeout(500);
    // The Jetzt card is a regular card again (#394): same width, same height, same text size
    const current = (await page.locator('.task[data-current]').boundingBox())!;
    expect(current.width).toBeCloseTo(280, 0);
    expect(current.x).toBeCloseTo(card.x, 0);
    expect(current.height).toBeCloseTo(card.height, 0);
    const title = await page.locator('.task[data-current]').evaluate(el => getComputedStyle(el.querySelector('.task-title-text')!).fontSize);
    expect(title).not.toBe('24px');
  });

  test('390px: the add-task button stays above the bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const add = (await page.locator('#column-open .add-task-button').boundingBox())!;
    const pill = (await bar(page).boundingBox())!;
    expect(add.y + add.height).toBeLessThanOrEqual(pill.y);
  });

  test('390px: drag edge arrows sit in the column-header row, not at the thumb zone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await showColumnPage(page, 1);
    await page.waitForTimeout(500);
    const waiting = (await page.locator('#column-waiting .task').first().boundingBox())!;
    await page.mouse.move(waiting.x + waiting.width / 2, waiting.y + waiting.height / 2);
    await page.mouse.down();
    await page.mouse.move(waiting.x + waiting.width / 2 + 10, waiting.y + waiting.height / 2 + 10, { steps: 5 });
    await page.mouse.move(200, 400, { steps: 8 });
    const header = (await page.locator('#column-progress h2').boundingBox())!;
    const headerCentre = header.y + header.height / 2;
    for (const side of ['left', 'right']) {
      const arrow = (await page.locator(`.edge-indicator--${side}`).boundingBox())!;
      expect(Math.abs(arrow.y + arrow.height / 2 - headerCentre)).toBeLessThanOrEqual(4);
      expect(arrow.y + arrow.height).toBeLessThan(844 / 2 - 100);
    }
    // Charging state and the 650ms hold are unchanged
    await page.mouse.move(380, 400, { steps: 8 });
    await expect(page.locator('.edge-indicator--right')).toHaveClass(/edge-indicator--charging/);
    await page.mouse.up();
  });

  test('390px: drag edge arrows follow a scrolled column header and clamp at the top (#231)', async ({ page, context }) => {
    await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(12)]);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const first = (await page.locator('#column-open .task').first().boundingBox())!;
    // Partially scrolled: the arrows move with the header row
    await page.locator('#column-open').evaluate(el => { el.scrollTop = 20; });
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2 - 20);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2 + 10, first.y + first.height / 2 - 10, { steps: 5 });
    await page.mouse.move(200, 400, { steps: 8 });
    const header = (await page.locator('#column-open h2').boundingBox())!;
    const left = (await page.locator('.edge-indicator--right').boundingBox())!;
    expect(Math.abs(left.y + left.height / 2 - (header.y + header.height / 2))).toBeLessThanOrEqual(4);
    // Header scrolled away: clamped at 0.5rem (no safe-area inset in the test browser), above the thumb zone
    await page.locator('#column-open').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(async () => (await page.locator('.edge-indicator--right').boundingBox())!.y).toBeCloseTo(8, 0);
    const clamped = (await page.locator('.edge-indicator--right').boundingBox())!;
    expect(clamped.y + clamped.height).toBeLessThan(844 / 2 - 100);
    await page.mouse.up();
  });

  test('390px: the sort control label is 12px, 11px on desktop (#229)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, '/tasks?seed=local');
    const trigger = page.locator('[data-testid="column-sorting-control"] button').first();
    await expect(trigger).toHaveCSS('font-size', '12px');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(trigger).toHaveCSS('font-size', '11px');
  });

  test('390px: the add-task bar is label-wide and centred (#244)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, '/tasks?seed=local');
    const add = (await page.locator('.add-task-slot--open .add-task-button').boundingBox())!;
    expect(add.width).toBeLessThan(280);
    expect(add.height).toBeGreaterThanOrEqual(48);
    expect(Math.abs(add.x + add.width / 2 - 195)).toBeLessThanOrEqual(2);
  });

  test('390px: the Erledigt CTA is full width, above the bar, and the last card is never covered', async ({ page, context }) => {
    await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(10, 3)]);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await showColumnPage(page, 2);
    const cta = dayCloseCta(page);
    await expect(cta).toBeVisible();
    await expect(cta).toBeInViewport({ ratio: 1 }); // sticky: reachable on a long list
    const box = (await cta.boundingBox())!;
    const pill = (await bar(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(pill.y);
    expect(box.width).toBeGreaterThan(300);
    // The CTA rests on the bar's gap, not floating above it: the column page's bottom padding already clears the bar,
    // so a second --phone-bar-offset on the sticky footer would lift it by about 72px
    expect(pill.y - (box.y + box.height)).toBeLessThanOrEqual(GAP_ABOVE_BAR_MAX);
    // Scrolled to the end, the last card ends above the sticky CTA's reserved space
    await page.locator('#column-done').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const last = (await page.locator('#column-done .task').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(pill.y);
  });

  test('390px: a swipe still switches the pages, and focus entering an off-screen page makes it active', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await expect(page.locator('.board')).toHaveAttribute('data-mobile-page', '0');
    await showColumnPage(page, 1);
    await expect(page.locator('.board')).toHaveAttribute('data-mobile-page', '1');
    await showColumnPage(page, 0);

    // Keyboard path (the tabs were it): focus on a card of the Erledigt page brings that page into view
    await page.locator('#column-done .task-wrapper').first().focus();
    await expect.poll(() => activeColumnPage(page)).toBe(2);
    // The page really is in view: focus must not scroll the clipped container on top of the board's translateX
    expect(await page.locator('.board-container').evaluate(el => el.scrollLeft)).toBe(0);
    await expect(page.locator('#column-done h2')).toBeInViewport({ ratio: 1 }); // after the 320ms slide
    await page.locator('#column-open .task-wrapper').first().focus();
    await expect.poll(() => activeColumnPage(page)).toBe(0);
  });

  test('390px: the bar fades out and takes no pointer while a card is dragged, and returns on drop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const nav = appNav(page);
    // The pills fade, never .app-nav itself: opacity < 1 on an ancestor makes it a Backdrop Root and the blur pops in
    // only at the end of the fade (#631)
    const pills = nav.locator('.app-nav-pill, .app-nav-more');
    await expect(pills.first()).toHaveCSS('opacity', '1');
    await pickUp(page, page.locator('#column-open .task-wrapper').first());
    for (const pill of await pills.all()) await expect(pill).toHaveCSS('opacity', '0');
    await expect(nav).toHaveCSS('opacity', '1');
    expect(await nav.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0');
    expect(await nav.locator('.app-nav-group').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    for (const pill of await pills.all()) await expect(pill).toHaveCSS('opacity', '1');
    await expect(nav).toHaveCSS('opacity', '1');
  });

  test('390px: the bar never swipes the board when a touch starts on it', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    const touch = finger(await context.newCDPSession(page), page);
    const pill = (await bar(page).boundingBox())!;
    await touch.start(pill.x + 60, pill.y + pill.height / 2);
    await touch.moveTo(pill.x - 30, pill.y + pill.height / 2, 10);
    await touch.end();
    await expect(page.locator('.board')).toHaveAttribute('data-mobile-page', '0');
  });

  test('desktop: the bar is on top, the Mehr panel replaces the dock, the CTA sits in the Erledigt column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);
    await expect(page.locator('#board-mobile-dock')).toHaveCount(0);
    const pill = (await bar(page).boundingBox())!;
    expect(pill.y).toBeLessThan(16);
    expect(pill.height).toBeCloseTo(36, 0); // 2.25rem
    const cta = (await dayCloseCta(page).boundingBox())!;
    const done = (await page.locator('#column-done').boundingBox())!;
    expect(cta.x).toBeGreaterThanOrEqual(done.x);
    expect(cta.x + cta.width).toBeLessThanOrEqual(done.x + done.width);
    expect(cta.height).toBeGreaterThanOrEqual(36);
    // No document scrollbar from the bar alone
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    await openMore(page);
  });

  test('desktop: the sticky CTA is painted above the cards of a long Erledigt list and stays in the viewport', async ({ page, context }) => {
    await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(8, 3)]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openBoard(page);
    const cta = dayCloseCta(page);
    await expect(cta).toBeInViewport({ ratio: 1 });
    const box = (await cta.boundingBox())!;
    // The element at the CTA's centre is the CTA itself (not a card covering it)
    const topmost = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(topmost).toBe('day-close-cta');
    await page.mouse.wheel(0, 3000);
    await expect(cta).toBeInViewport({ ratio: 1 });
  });

  test('desktop: the CTA is hidden while nothing is done today', async ({ page, context }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(task => task.status !== 3));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/tasks');
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible();
    await expect(dayCloseCta(page)).toHaveCount(0);
  });
});
