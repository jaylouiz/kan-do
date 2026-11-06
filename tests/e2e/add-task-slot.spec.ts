import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLocalBoard, SEED_TASKS } from './helpers/seed';
import { showColumnPage } from './helpers/dnd';

/**
 * #125: both add controls are card-sized slots that morph into a card in the same box.
 * Offen: always-visible label; the card is the in-card flow (#649, `new-card-flow.spec.ts`). Jetzt (empty only):
 * revealed by hovering the Jetzt section or by focus, opens add-and-start (the sheet's draft card); the saved card
 * is the regular Jetzt card.
 */

// Mobile cards are capped at 17.5rem and centred in the column (#234); below ~312px the 1rem gutter (#220) wins
const MOBILE_CARD_MAX_PX = 280;
const MOBILE_GUTTER_PX = 16;
const mobileCardX = (viewportWidth: number) =>
  Math.max(MOBILE_GUTTER_PX, (viewportWidth - MOBILE_CARD_MAX_PX) / 2);
const EMPTY_JETZT = SEED_TASKS.filter((task) => task.status !== 1);

const offen = (page: Page) => page.locator('#column-open');
const jetzt = (page: Page) => page.locator('#column-progress');
const slotButton = (column: Locator) => column.locator('.add-task-button');
const slotSurface = (column: Locator) => column.locator('.add-task-button-surface');
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** The Offen add button adds in the card itself (#649) */
const newCard = (column: Locator) => column.getByTestId('new-card-flow');

/** Parks the pointer in the page corner, outside every column. */
const parkPointer = async (page: Page) => {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width - 2, viewport.height - 2);
};

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** The focused element after a save: the saved card's keyboard target (Tab order), not a programmatic -1. */
const focusedCard = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el && { className: el.className, taskId: el.dataset.taskId ?? null, tabIndex: el.tabIndex, label: el.getAttribute('aria-label') };
  });

const expectSameBox = (actual: { x: number; y: number; width: number; height: number }, expected: typeof actual) => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(1);
};

test.describe('Add slot, desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.describe('with an empty Jetzt', () => {
    test.beforeEach(async ({ context, page }) => {
      await seedLocalBoard(context, EMPTY_JETZT);
      await page.goto('/tasks');
      await expect(offen(page).locator('.task-wrapper').first()).toBeVisible();
      await parkPointer(page);
    });

    test('Offen slot is a card-sized box holding a compact soft surface that grows to the card on hover (#466)', async ({ page }) => {
      const button = slotButton(offen(page));
      const surface = slotSurface(offen(page));
      const card = offen(page).locator('.task-wrapper .task').first();

      await expect(button).toHaveText('Aufgabe hinzufügen');
      await expect(button).toHaveCSS('opacity', '1');
      await expect(button).toHaveCSS('background-color', TRANSPARENT);
      await expect(button).toHaveCSS('box-shadow', 'none');
      // Soft grey at rest, same token as the old hover surface
      await expect(surface).not.toHaveCSS('background-color', TRANSPARENT);
      const grey = await surface.evaluate((el) => getComputedStyle(el).backgroundColor);

      const slot = await box(button);
      const cardBox = await box(card);
      expect(Math.round(slot.height)).toBe(132);
      expect(Math.abs(slot.width - cardBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(slot.x - cardBox.x)).toBeLessThanOrEqual(1);
      await expect(button).toHaveCSS('border-radius', await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius));
      await expect(surface).toHaveCSS('border-radius', await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius));

      // Compact at rest: 36px tall, label-wide, centred in the slot
      const compact = await box(surface);
      expect(Math.round(compact.height)).toBe(36);
      expect(compact.width).toBeLessThan(slot.width - 40);
      expect(Math.abs(compact.x + compact.width / 2 - (slot.x + slot.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(compact.y + compact.height / 2 - (slot.y + slot.height / 2))).toBeLessThanOrEqual(1);

      // Last item of the list, after the cards
      const lastCard = await box(offen(page).locator('.task-wrapper').last());
      expect(slot.y).toBeGreaterThan(lastCard.y + lastCard.height);

      // Hover: the surface becomes exactly the card box, the slot never moves
      await button.hover();
      await expect.poll(async () => Math.round((await box(surface)).height)).toBe(132);
      expectSameBox(await box(surface), slot);
      await expect(surface).toHaveCSS('background-color', grey);
      await expect(button).toHaveCSS('box-shadow', 'none');
      expectSameBox(await box(button), slot);
      // Icon + label stay centred as a group
      const icon = await box(button.locator('.add-task-button-icon'));
      const label = await box(button.locator('.add-task-button-label'));
      expect(Math.abs((icon.x + label.x + label.width) / 2 - (slot.x + slot.width / 2))).toBeLessThanOrEqual(1);
    });

    test('the resting add-task surface is as high as the day-close button (#582)', async ({ page }) => {
      const cta = page.getByTestId('day-close-cta');
      await expect(cta).toBeVisible();
      const surface = await box(slotSurface(offen(page)));
      const close = await box(cta);
      expect(Math.round(surface.height)).toBe(Math.round(close.height));
      // The hit target is the card-sized button, far above WCAG 2.2 AA 24x24
      const hit = await box(slotButton(offen(page)));
      expect(hit.width).toBeGreaterThanOrEqual(24);
      expect(hit.height).toBeGreaterThanOrEqual(24);
    });

    test('Offen: hover grows, leaving shrinks back, and again (A -> B -> A)', async ({ page }) => {
      const button = slotButton(offen(page));
      const surface = slotSurface(offen(page));
      const slot = await box(button);
      const height = async () => Math.round((await box(surface)).height);

      await button.hover();
      await expect.poll(height).toBe(132);
      await parkPointer(page);
      await expect.poll(height).toBe(36);
      await button.hover();
      await expect.poll(height).toBe(132);
      expectSameBox(await box(button), slot);
    });

    test('Offen: keyboard focus grows the surface with the ink ring around the card box; blur shrinks it back', async ({ page }) => {
      const button = slotButton(offen(page));
      const surface = slotSurface(offen(page));
      const slot = await box(button);
      const height = async () => Math.round((await box(surface)).height);

      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await expect.poll(height).toBe(132);
      await expect(button).toHaveCSS('outline-style', 'solid');
      expectSameBox(await box(button), slot);

      await button.blur();
      await expect.poll(height).toBe(36);
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect.poll(height).toBe(132);
    });

    test('Offen: the surface stays grown while the new card shows; Escape returns focus and it shrinks back', async ({ page }) => {
      const button = slotButton(offen(page));
      const surface = slotSurface(offen(page));
      const height = async () => Math.round((await box(surface)).height);

      await button.hover();
      await button.click();
      await expect(newCard(offen(page))).toBeVisible();
      await parkPointer(page);
      // Held grown under the fading label: no jump back to the compact button
      await expect.poll(height).toBe(132);
      await expect(offen(page).locator('.add-task-slot')).toHaveClass(/is-drafting/);

      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(button).toBeFocused();
      // Focus returned by script, not by the keyboard: focus-visible decides whether it stays grown
      const focusVisible = await button.evaluate((el) => el.matches(':focus-visible'));
      await expect.poll(height).toBe(focusVisible ? 132 : 36);
      await button.blur();
      await expect.poll(height).toBe(36);
    });

    test('a drag that ends over the Offen slot leaves no stuck grown state', async ({ page }) => {
      const surface = slotSurface(offen(page));
      const slotBox = await box(slotButton(offen(page)));
      const from = await box(offen(page).locator('.task-wrapper').first());

      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
      await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2, { steps: 10 });
      await expect(page.locator('.board')).toHaveClass(/dragging/);
      await page.mouse.up();
      await expect(page.locator('.board')).not.toHaveClass(/dragging/);
      await expect(offen(page).locator('.add-task-slot')).toHaveCSS('visibility', 'visible');
      // The slot may have moved down by the dropped card; the pointer is re-evaluated against the new layout
      await parkPointer(page);
      await expect.poll(async () => Math.round((await box(surface)).height)).toBe(36);
    });

    test('Jetzt slot is hidden at rest and revealed by hovering the Jetzt section, not Wartet', async ({ page }) => {
      const button = slotButton(jetzt(page));
      await expect(button).toHaveText('Neue Aufgabe sofort starten');
      await expect(button).toHaveCSS('opacity', '0');

      await page.locator('#column-progress h2').hover();
      await expect(button).toHaveCSS('opacity', '1');
      // The label keeps the full text-muted colour of the Offen label (no faded resting state)
      await expect(button).toHaveCSS('color', await slotButton(offen(page)).evaluate((el) => getComputedStyle(el).color));

      await page.locator('#column-waiting .task-wrapper').first().hover();
      await expect(button).toHaveCSS('opacity', '0');
    });

    test('keyboard focus reveals the Jetzt slot; it is a native button named by its label', async ({ page }) => {
      const button = page.getByRole('button', { name: 'Neue Aufgabe sofort starten', exact: true });
      await expect(button).toHaveCount(1);
      await button.focus();
      await expect(button).toHaveCSS('opacity', '1');
      await expect(button).toHaveCSS('outline-style', 'solid');
    });

    test('Offen: the slot morphs into the new card in the same box, which shows the title live', async ({ page }) => {
      const button = slotButton(offen(page));
      const before = await box(button);
      await button.click();
      await expect(page).toHaveURL(/\/tasks$/); // no sheet, no route change (#649)

      const card = newCard(offen(page));
      await expect(card).toBeVisible();
      expectSameBox(await box(card), before);
      await expect(offen(page).locator('.add-task-button-label')).toHaveCSS('opacity', '0');

      await page.getByTestId('new-card-title').fill('Angebot an Kunde');
      await expect(card.locator('.task-title-text')).toHaveText('Angebot an Kunde');
    });

    test('Offen: save puts the card at the new card position, a fresh slot below, focus on the new card', async ({ page }) => {
      const button = slotButton(offen(page));
      const before = await box(button);
      await button.click();
      await page.getByTestId('new-card-title').fill('Neue Aufgabe');
      await page.keyboard.press('Enter');
      // Thema, Aktivität and Timebox are skipped with Enter, Notiz saves
      for (const step of ['topic', 'activity', 'timebox']) {
        await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', step);
        await page.keyboard.press('Enter');
      }
      await expect(page.getByTestId('new-card-notes')).toBeFocused();
      await page.keyboard.press('Enter');

      const saved = offen(page).locator('.task-wrapper').last();
      await expect(saved).toHaveAttribute('aria-label', 'Neue Aufgabe');
      expect(Math.abs((await box(saved)).y - before.y)).toBeLessThanOrEqual(1);
      await expect(saved).toBeFocused();
      const savedId = await saved.getAttribute('data-task-id');
      expect(savedId).toMatch(/^local_/);
      expect(await focusedCard(page)).toEqual({ className: 'task-wrapper', taskId: savedId, tabIndex: 0, label: 'Neue Aufgabe' });
      await expect(newCard(offen(page))).toHaveCount(0);
      expect((await box(button)).y).toBeGreaterThan(before.y + before.height);
    });

    test('Jetzt: the slot morphs into a regular-size draft with the running time; it is not a task', async ({ page }) => {
      await page.clock.install();
      await page.reload();
      await page.locator('#column-progress h2').hover();
      const button = slotButton(jetzt(page));
      const before = await box(button);
      await button.click();
      await page.waitForURL(/\/tasks\/add\?mode=adhoc/);
      await expect(page.getByRole('dialog', { name: 'Neue Aufgabe sofort starten' })).toBeVisible();

      const draft = jetzt(page).getByTestId('task-draft-card').locator('.task');
      await expect(draft).toBeVisible();
      expectSameBox(await box(draft), before);
      await expect(draft).not.toHaveAttribute('data-current', '');

      // Whole minutes like a running card, ticking with the add form's timer; at the start of the
      // footer, which the sheet never covers
      const elapsed = draft.locator('.task-draft-elapsed');
      await expect(elapsed).toHaveText('0 min');
      expect((await box(elapsed)).x - (await box(draft)).x).toBeLessThan(40);
      await page.clock.runFor(61_000);
      await expect(elapsed).toHaveText('1 min');

      // Never a task: not draggable, not counted, not in the store
      await expect(jetzt(page).locator('.task-wrapper')).toHaveCount(0);
      const stored = await page.evaluate(() => localStorage.getItem('tasks-store') ?? '');
      expect(stored).not.toContain('"draft"');

      await page.locator('input[name="title"]').fill('Rückruf');
      await expect(draft.locator('.task-title-text')).toHaveText('Rückruf');
    });

    test('Jetzt: save turns the draft into the current card, a regular card that keeps the time', async ({ page }) => {
      await page.locator('#column-progress h2').hover();
      await slotButton(jetzt(page)).click();
      await page.locator('input[name="title"]').fill('Rückruf Kunde');
      await page.waitForTimeout(2100);
      await page.locator('input[name="title"]').press('Enter');
      await page.waitForURL(/\/tasks$/);
      // No "created" toast (#136): the focused card in Jetzt is the confirmation
      await expect(page.locator('[data-slot="viewport"] [data-slot="root"]')).toHaveCount(0);

      const current = jetzt(page).locator('.task-wrapper');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('aria-label', 'Rückruf Kunde');
      await expect(current.locator('.task')).toHaveAttribute('data-current', '');
      await expect.poll(async () => Math.round((await box(current.locator('.task'))).height)).toBe(132);
      await expect(current).toBeFocused();
      const currentId = await current.getAttribute('data-task-id');
      expect(currentId).toMatch(/^local_/);
      expect(await focusedCard(page)).toEqual({ className: 'task-wrapper', taskId: currentId, tabIndex: 0, label: 'Rückruf Kunde' });
      await expect(slotButton(jetzt(page))).toHaveCount(0);

      // Elapsed time carried over and the timer runs
      const seconds = async () =>
        page.evaluate(() => {
          const store = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: { title: string; timeSpentSeconds: number }[] };
          return store.tasks?.find((task) => task.title === 'Rückruf Kunde')?.timeSpentSeconds ?? 0;
        });
      expect(await seconds()).toBeGreaterThanOrEqual(2);
      await expect.poll(seconds, { timeout: 4000 }).toBeGreaterThanOrEqual(4);
    });

    for (const [name, close] of [
      ['Escape', async (page: Page) => page.keyboard.press('Escape')],
      ['Abbrechen', async (page: Page) => page.getByRole('button', { name: 'Abbrechen' }).click()],
      ['overlay click', async (page: Page) => page.mouse.click(40, 450)],
    ] as const) {
      test(`Jetzt: ${name} reverses the draft to the slot and returns focus to it`, async ({ page }) => {
        const button = slotButton(jetzt(page));
        await button.focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(/\/tasks\/add\?mode=adhoc/);
        await expect(jetzt(page).getByTestId('task-draft-card')).toBeVisible();

        await close(page);
        await page.waitForURL(/\/tasks$/);
        await expect(jetzt(page).getByTestId('task-draft-card')).toHaveCount(0);
        await expect(button).toBeFocused();
        await expect(jetzt(page).locator('.task-wrapper')).toHaveCount(0);
      });
    }

    test('Offen: Space opens the new card and Escape returns focus to the slot', async ({ page }) => {
      const button = slotButton(offen(page));
      await button.focus();
      await page.keyboard.press('Space');
      await expect(newCard(offen(page))).toBeVisible();
      await expect(page.getByTestId('new-card-title')).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect(button).toBeFocused();
    });

    test('during a drag the Offen slot keeps its box but is hidden; the Jetzt slot is gone', async ({ page }) => {
      const button = slotButton(offen(page));
      const before = await box(button);
      const source = offen(page).locator('.task-wrapper').first();
      const from = await box(source);
      const target = await box(page.locator('#column-waiting'));

      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
      await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 10 });
      await expect(page.locator('.board')).toHaveClass(/dragging/);

      await expect(offen(page).locator('.add-task-slot')).toHaveCSS('visibility', 'hidden');
      expect(Math.round((await box(offen(page).locator('.add-task-slot'))).height)).toBe(Math.round(before.height));
      await expect(slotButton(jetzt(page))).toHaveCount(0);

      await page.mouse.up();
      await expect(page.locator('.board')).not.toHaveClass(/dragging/);
      await expect(offen(page).locator('.add-task-slot')).toHaveCSS('visibility', 'visible');
      await expect(slotButton(jetzt(page))).toHaveCount(1);
    });
  });

  test('with Jetzt occupied there is no Jetzt add control', async ({ context, page }) => {
    await seedLocalBoard(context);
    await page.goto('/tasks');
    await expect(jetzt(page).locator('.task-wrapper')).toHaveCount(1);
    await page.locator('#column-progress h2').hover();
    await expect(slotButton(jetzt(page))).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Neue Aufgabe sofort starten' })).toHaveCount(0);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('reveal and morph are instant', async ({ context, page }) => {
      await seedLocalBoard(context, EMPTY_JETZT);
      await page.goto('/tasks');
      const button = slotButton(jetzt(page));
      await expect(button).toHaveCSS('transition-duration', '0s');
      await expect(offen(page).locator('.add-task-button-label')).toHaveCSS('transition-duration', '0s');
      // Growth and shrink are instant on the Offen surface, with the same end states
      const surface = slotSurface(offen(page));
      await expect(surface).toHaveCSS('transition-duration', '0s');
      expect(Math.round((await box(surface)).height)).toBe(36);
      await slotButton(offen(page)).hover();
      expect(await surface.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(132);
      await parkPointer(page);

      await page.locator('#column-progress h2').hover();
      await button.click();
      await expect(jetzt(page).getByTestId('task-draft-card')).toHaveCSS('animation-name', 'none');
      await page.locator('input[name="title"]').fill('Sofort');
      await page.locator('input[name="title"]').press('Enter');
      await page.waitForURL(/\/tasks$/);
      await expect(jetzt(page).locator('.task')).toBeVisible();
    });
  });
});

test.describe('Add slot, 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the sticky add-task bar is as high as the day-close button (#582)', async ({ context, page }) => {
    await seedLocalBoard(context, EMPTY_JETZT);
    await page.goto('/tasks');
    const cta = page.getByTestId('day-close-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    const surface = await box(slotSurface(offen(page)));
    const close = await box(cta);
    expect(Math.round(surface.height)).toBe(Math.round(close.height));
  });

  test('Offen keeps the sticky 48px bar; tapping it swaps the bar for the new card at the end of the list', async ({ context, page }) => {
    await seedLocalBoard(context, EMPTY_JETZT);
    await page.goto('/tasks');
    const button = slotButton(offen(page));
    await expect(button).toBeVisible();
    expect(Math.round((await box(button)).height)).toBe(48);
    await expect(offen(page).locator('.add-task-slot')).toHaveCSS('position', 'sticky');
    // The surface carries the soft grey and is the bar itself (label-wide, 48px)
    const surface = slotSurface(offen(page));
    await expect(surface).not.toHaveCSS('background-color', TRANSPARENT);
    await expect(button).toHaveCSS('background-color', TRANSPARENT);
    expectSameBox(await box(surface), await box(button));

    await button.click();
    const card = newCard(offen(page));
    await expect(card).toBeVisible();
    await expect(button).toBeHidden();
    // The card follows the last card (one measurement, it scrolls itself into view)
    const gap = await offen(page).evaluate((column) => {
      const cards = column.querySelectorAll('.task-wrapper');
      const last = cards[cards.length - 1]!.getBoundingClientRect();
      return column.querySelector('[data-testid="new-card-flow"]')!.getBoundingClientRect().top - last.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  test('Offen bar rests directly below the last card on a short list (#144)', async ({ context, page }) => {
    const shortOffen = [...EMPTY_JETZT.filter((task) => task.status === 0).slice(0, 2)];
    await seedLocalBoard(context, shortOffen);
    await page.goto('/tasks');
    await expect(slotButton(offen(page))).toBeVisible();
    const gap = await offen(page).evaluate((column) => {
      const cards = column.querySelectorAll('.task-wrapper');
      const last = cards[cards.length - 1]!.getBoundingClientRect();
      return column.querySelector('.add-task-slot')!.getBoundingClientRect().top - last.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(24);
  });

  test('Offen bar keeps the card gap below a collapsed stack and never overlaps it', async ({ context, page }) => {
    const [first, second] = EMPTY_JETZT.filter((task) => task.status === 0);
    const stacked = [
      { ...first!, id: 'stack-single', topic: 'Software' },
      { ...first!, id: 'stack-a', topic: 'Design' },
      { ...second!, id: 'stack-b', topic: 'Design' },
    ];
    await seedLocalBoard(context, stacked, {}, { enabled: true, key: 'topic' });
    // Short viewport: the bar's natural place is close to the app bar, where a doubled bar offset used to pin it up over the stack
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/tasks');
    await expect(offen(page).locator('.task-stack')).toBeVisible();
    await expect(slotButton(offen(page))).toBeVisible();
    // The sticky bar must sit at its natural place after the stack, not be pinned up over it
    const gap = await offen(page).evaluate((column) => {
      const stack = column.querySelector('.task-stack')!.getBoundingClientRect();
      return column.querySelector('.add-task-slot')!.getBoundingClientRect().top - stack.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(24);
  });

  test('Offen bar stays above the phone app bar on a long list (#144, #470)', async ({ context, page }) => {
    const template = EMPTY_JETZT.find((task) => task.status === 0)!;
    const longOffen = Array.from({ length: 12 }, (_, i) => ({ ...template, id: `long-${i}`, title: `Long ${i}` }));
    await seedLocalBoard(context, longOffen);
    await page.goto('/tasks');
    const button = slotButton(offen(page));
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport({ ratio: 1 });
    const barTop = (await box(page.locator('[data-app-nav] .app-nav-pill'))).y;
    expect((await box(button)).y + (await box(button)).height).toBeLessThanOrEqual(barTop);
  });

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('tapping the Offen bar leaves no grown state and keeps a 44px+ target', async ({ context, page }) => {
      await seedLocalBoard(context, EMPTY_JETZT);
      await page.goto('/tasks');
      const button = slotButton(offen(page));
      const surface = slotSurface(offen(page));
      await expect(button).toBeVisible();
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      await button.tap();
      await expect(newCard(offen(page))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect.poll(async () => Math.round((await box(surface)).height)).toBe(48);
    });

    test('the empty Jetzt tab shows the labelled slot at rest, which morphs on tap', async ({ context, page }) => {
      await seedLocalBoard(context, EMPTY_JETZT);
      await page.goto('/tasks');
      await showColumnPage(page, 1);

      const button = slotButton(jetzt(page));
      await expect(button).toBeInViewport({ ratio: 1 });
      // Wait for the tab slide to finish before measuring
      await expect.poll(async () => Math.round((await box(button)).x)).toBe(Math.round(mobileCardX(page.viewportSize()!.width)));
      await expect(button).toHaveCSS('opacity', '1');
      await expect(button).toHaveText('Neue Aufgabe sofort starten');
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      const before = await box(button);
      await button.tap();
      const draft = jetzt(page).getByTestId('task-draft-card').locator('.task');
      await expect(draft).toBeVisible();
      expectSameBox(await box(draft), before);
    });
  });
});
