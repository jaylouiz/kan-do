import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLocalBoard, SEED_TASKS } from './helpers/seed';
import { hover, pickUp, showColumnPage, dropSettled } from './helpers/dnd';
import { settleAnimations } from './helpers/settle';

/**
 * #125, #248: Offen adds from a round button in its column header; the draft card (the in-card flow, #649,
 * `new-card-flow.spec.ts`) enters at the top of the list and the list holds no add slot of its own. Jetzt (empty only):
 * a card-sized slot revealed by hovering the Jetzt section or by focus, opens add-and-start (the sheet's draft card); the
 * saved card is the regular Jetzt card.
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
/** The Offen header's round add button (#248): the one add entry of Offen */
const headerAdd = (page: Page) => offen(page).getByRole('button', { name: 'Aufgabe hinzufügen' });
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

    test('Offen has one round soft add button in its header, aligned with the cards and centred on the title; no other column has one (#248)', async ({ page }) => {
      const add = headerAdd(page);
      await expect(add).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Aufgabe hinzufügen' })).toHaveCount(1);
      const button = await box(add);
      const title = await box(offen(page).locator('h2'));
      const card = await box(offen(page).locator('.task-wrapper .task').first());
      expect(Math.round(button.width)).toBe(32);
      expect(Math.round(button.height)).toBe(32);
      await expect(add).toHaveCSS('border-top-left-radius', '9999px');
      await expect(add).not.toHaveCSS('background-color', TRANSPARENT);
      // The cards' left edge (#264), and the centre of the title line
      expect(Math.abs(button.x - card.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(button.y + button.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(1);
      // Never over the title, which stays centred on the cards like the other columns' titles
      expect(button.x + button.width).toBeLessThanOrEqual(title.x);
      expect(Math.abs(title.x + title.width / 2 - (card.x + card.width / 2))).toBeLessThanOrEqual(1);
      await expect(page.locator('#column-progress, #column-waiting, #column-done').getByRole('button', { name: 'Aufgabe hinzufügen' })).toHaveCount(0);
    });

    test('hovering or focusing the header button shows a tooltip with its name; none while it is disabled (#264)', async ({ page }) => {
      const add = headerAdd(page);
      await add.hover();
      await expect(page.getByRole('tooltip')).toHaveText('Aufgabe hinzufügen');
      await parkPointer(page);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.keyboard.press('Tab'); // any focus move; then focus the button by keyboard
      await add.focus();
      await expect(page.getByRole('tooltip')).toHaveText('Aufgabe hinzufügen');
    });

    test('Offen list has no add control or reserved box: the first card sits at the top of the list, the list ends with its last card (#248)', async ({ page }) => {
      await expect(offen(page).locator('.add-task-button, [data-add-slot="open"], [data-testid="add-task-button"]')).toHaveCount(0);
      const list = await box(offen(page).locator('.task-list'));
      const first = await box(offen(page).locator('.task-wrapper').first());
      expect(Math.abs(first.y - list.y)).toBeLessThanOrEqual(1);
      expect(await offen(page).locator('.add-task-slot').evaluate((el) => getComputedStyle(el).display)).toBe('contents');
    });

    test('Offen: the button shows the draft card at the top; the cards move down, a second click opens nothing, Escape returns focus to the button', async ({ page }) => {
      const add = headerAdd(page);
      const firstCard = offen(page).locator('.task-wrapper .task').first();
      const buttonBefore = await box(add);
      const cardBefore = await box(firstCard);
      await add.click();
      await expect(page).toHaveURL(/\/tasks$/); // no sheet, no route change (#649)

      const card = newCard(offen(page));
      await expect(card).toBeVisible();
      // Above the first card, in the card column, a regular card's box
      // The cards below follow the draft: the list gap between it and the first card (0.75rem)
      await expect.poll(async () => {
        const d = await box(card);
        return Math.round((await box(firstCard)).y - (d.y + d.height));
      }).toBe(12);
      await settleAnimations(page);
      const draft = await box(card);
      expect(Math.abs(draft.y - cardBefore.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(draft.x - cardBefore.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(draft.width - cardBefore.width)).toBeLessThanOrEqual(1);
      // The header stays: the button keeps its place, does nothing, and never opens a second card
      expectSameBox(await box(add), buttonBefore);
      await expect(add).toBeDisabled();
      await add.click({ force: true });
      await expect(newCard(offen(page))).toHaveCount(1);

      await page.getByTestId('new-card-title').fill('Angebot an Kunde');
      await expect(card.locator('.task-title-text')).toHaveText('Angebot an Kunde');
      await page.getByTestId('new-card-title').fill('');
      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect(add).toBeFocused();
      await expect(add).toBeEnabled();
      await expect(page.getByRole('tooltip')).toHaveCount(0); // focus returned by the column, not hover: no tooltip (kd#40)
      // The cards close up again: the first card is back where it was
      await expect.poll(async () => Math.round((await box(firstCard)).y)).toBe(Math.round(cardBefore.y));
    });

    test('Offen: Enter and Space on the focused button open the card; the title takes focus', async ({ page }) => {
      const add = headerAdd(page);
      for (const key of ['Enter', 'Space']) {
        await add.focus();
        await page.keyboard.press(key);
        await expect(newCard(offen(page))).toBeVisible();
        await expect(page.getByTestId('new-card-title')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(newCard(offen(page))).toHaveCount(0);
        await expect(add).toBeFocused();
      }
    });

    test('Offen: the draft enters in 200ms or less with the cards following, no jump (#248)', async ({ page }) => {
      await headerAdd(page).click();
      const timing = await offen(page).locator('.add-task-slot-draft-wrap').evaluate((el) =>
        el.getAnimations().map((animation) => ({ property: (animation as CSSTransition).transitionProperty, duration: Number(animation.effect!.getComputedTiming().duration) })),
      );
      expect(timing.map((t) => t.property).sort()).toEqual(['grid-template-rows', 'margin-bottom', 'opacity']);
      for (const { duration } of timing) expect(duration).toBeLessThanOrEqual(200);
    });

    test('Offen: save puts the card into the list, focus on it, the button is live again', async ({ page }) => {
      await headerAdd(page).click();
      await page.getByTestId('new-card-title').fill('Neue Aufgabe');
      await page.keyboard.press('Enter');
      // Thema, Aktivität and Timebox are skipped with Enter, Notiz saves
      for (const step of ['topic', 'activity', 'timebox']) {
        await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', step);
        await page.keyboard.press('Enter');
      }
      await expect(page.getByTestId('new-card-notes')).toBeFocused();
      await page.keyboard.press('Enter');

      const saved = offen(page).locator('.task-wrapper').filter({ hasText: 'Neue Aufgabe' });
      await expect(saved).toHaveAttribute('aria-label', 'Neue Aufgabe');
      await expect(saved).toBeFocused();
      const savedId = await saved.getAttribute('data-task-id');
      expect(savedId).toMatch(/^local_/);
      expect(await focusedCard(page)).toEqual({ className: 'task-wrapper', taskId: savedId, tabIndex: 0, label: 'Neue Aufgabe' });
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect(headerAdd(page)).toBeEnabled();
    });

    test('Offen: dragging a card keeps the header button in place and out of the drop targets; a drag that ends over the header leaves nothing stuck', async ({ page }) => {
      const add = headerAdd(page);
      const before = await box(add);
      const from = await box(offen(page).locator('.task-wrapper').first());
      const target = await box(page.locator('#column-waiting'));

      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
      await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 10 });
      await expect(page.locator('.board')).toHaveClass(/dragging/);
      expectSameBox(await box(add), before);
      await expect(offen(page).locator('.add-task-button')).toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator('.board')).not.toHaveClass(/dragging/);
      expectSameBox(await box(add), before);

      // Pulled over the button and released: the card stays in Offen, nothing opens
      const card = await box(offen(page).locator('.task-wrapper').first());
      await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
      await page.mouse.down();
      await page.mouse.move(card.x + card.width / 2 + 10, card.y + card.height / 2 + 10, { steps: 5 });
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect(page.locator('.board')).not.toHaveClass(/dragging/);
      await expect(newCard(offen(page))).toHaveCount(0);
      expectSameBox(await box(add), before);
    });

    test('Offen: a drag started while the draft is open moves no card; the draft stays hidden in its place and returns after the drop with what was typed (#248)', async ({ page }) => {
      await headerAdd(page).click();
      await expect(newCard(offen(page))).toBeVisible();
      await settleAnimations(page);
      const wrappers = offen(page).locator('.task-wrapper');
      const ys = async () => (await wrappers.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top * 10) / 10)));
      const before = await ys();
      const draftBefore = await box(offen(page).locator('.add-task-slot-draft-wrap'));
      const second = wrappers.nth(1);
      const dragged = await second.getAttribute('data-task-id');

      await pickUp(page, second);
      // dnd-kit measures the shapes at the start: nothing may slide, then or a moment later (the old collapse took 200ms)
      for (let i = 0; i < 5; i++) {
        expect(await ys()).toEqual(before);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 60)));
      }
      expectSameBox(await box(offen(page).locator('.add-task-slot-draft-wrap')), draftBefore);
      await expect(offen(page).locator('.add-task-slot')).toHaveClass(/is-hidden/);

      await hover(page, page.locator('#column-waiting .task-wrapper').first());
      await page.mouse.up();
      await dropSettled(page);
      await expect(page.locator(`#column-waiting .task-wrapper[data-task-id="${dragged}"]`)).toHaveCount(1);
      // The blank draft was not thrown away: it is back, live, at the top
      await expect(newCard(offen(page))).toBeVisible();
      await expect(offen(page).locator('.add-task-slot')).not.toHaveClass(/is-hidden/);
      await expect(page.getByTestId('new-card-title')).toBeFocused();
    });

    test('Offen: a typed draft survives a drag of a card out of Offen (#248)', async ({ page }) => {
      await headerAdd(page).click();
      await page.getByTestId('new-card-title').fill('Bleibt');
      const second = offen(page).locator('.task-wrapper').nth(1);
      await pickUp(page, second);
      await hover(page, page.locator('#column-waiting .task-wrapper').first());
      await page.mouse.up();
      await dropSettled(page);
      await expect(newCard(offen(page))).toBeVisible();
      await expect(page.getByTestId('new-card-title')).toHaveValue('Bleibt');
    });

    test('Offen: a plain press on a card still throws away a blank draft, on release (#248)', async ({ page }) => {
      await headerAdd(page).click();
      await expect(newCard(offen(page))).toBeVisible();
      await offen(page).locator('.task-wrapper').nth(1).click();
      await expect(newCard(offen(page))).toHaveCount(0);
    });

    test('Jetzt slot is hidden at rest and revealed by hovering the Jetzt section, not Wartet', async ({ page }) => {
      const button = slotButton(jetzt(page));
      await expect(button).toHaveText('Neue Aufgabe sofort starten');
      await expect(button).toHaveCSS('opacity', '0');

      await page.locator('#column-progress h2').hover();
      await expect(button).toHaveCSS('opacity', '1');
      // The label keeps the full text-muted colour (no faded resting state)
      const muted = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--ui-text-muted)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await expect(button).toHaveCSS('color', muted);

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

  });

  test('an empty Offen still has the header button; the draft opens on the empty list and cancelling leaves the drop zone (#248)', async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS.filter((task) => task.status !== 0));
    await page.goto('/tasks');
    await expect(offen(page).locator('.task-wrapper')).toHaveCount(0);
    await expect(headerAdd(page)).toBeVisible();
    await headerAdd(page).click();
    await expect(newCard(offen(page))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(newCard(offen(page))).toHaveCount(0);
    await expect(offen(page).locator('.column-drop-zone')).toHaveCount(1);
    await expect(headerAdd(page)).toBeFocused();
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
      // The Offen draft enters without any transition: the cards below sit at their final place at once (#248)
      await headerAdd(page).click();
      await expect(newCard(offen(page))).toBeVisible();
      expect(await offen(page).locator('.add-task-slot-draft-wrap').evaluate((el) => el.getAnimations().length)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);

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

  test('Offen: no sticky bar; the round header button (44px, cards\' left edge) shows the draft at the top (#248)', async ({ context, page }) => {
    await seedLocalBoard(context, EMPTY_JETZT);
    await page.goto('/tasks');
    await showColumnPage(page, 0);
    await expect.poll(async () => Math.round((await box(offen(page).locator('.task-wrapper .task').first())).x)).toBe(Math.round(mobileCardX(390))); // the page slide has settled
    await expect(offen(page).locator('.add-task-button, [data-add-slot="open"]')).toHaveCount(0);
    const stickies = await offen(page).evaluate((column) => [...column.querySelectorAll('*')].filter((el) => getComputedStyle(el).position === 'sticky').length);
    expect(stickies).toBe(0);

    const add = headerAdd(page);
    await expect(add).toBeVisible();
    const button = await box(add);
    const firstCard = offen(page).locator('.task-wrapper .task').first();
    const cardBefore = await box(firstCard);
    expect(Math.round(button.width)).toBe(44);
    expect(Math.round(button.height)).toBe(44);
    expect(Math.abs(button.x - cardBefore.x)).toBeLessThanOrEqual(1);
    const title = await box(offen(page).locator('h2'));
    expect(button.x + button.width).toBeLessThanOrEqual(title.x);
    expect(Math.abs(title.x + title.width / 2 - (cardBefore.x + cardBefore.width / 2))).toBeLessThanOrEqual(1);
    // No hover on the phone layout: no tooltip even on focus (#264)
    await add.focus();
    await page.waitForTimeout(700);
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await add.click();
    const card = newCard(offen(page));
    await expect(card).toBeVisible();
    await expect.poll(async () => Math.round((await box(card)).y)).toBe(Math.round(cardBefore.y));
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect(add).toBeDisabled();
  });

  test('Offen, a long list: the button sits at the top, the draft opens in view without scrolling to the end (#248)', async ({ context, page }) => {
    const template = EMPTY_JETZT.find((task) => task.status === 0)!;
    const longOffen = Array.from({ length: 12 }, (_, i) => ({ ...template, id: `long-${i}`, title: `Long ${i}` }));
    await seedLocalBoard(context, longOffen);
    await page.goto('/tasks');
    await showColumnPage(page, 0);
    await expect(headerAdd(page)).toBeInViewport({ ratio: 1 });
    await headerAdd(page).click();
    await expect(newCard(offen(page))).toBeInViewport({ ratio: 1 });
    // The draft's mount scroll does not push the column title and the add button out of view (they are what Esc returns to)
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));
    await expect(offen(page).locator('h2')).toBeInViewport({ ratio: 1 });
    await expect(headerAdd(page)).toBeInViewport({ ratio: 1 });
    await expect(newCard(offen(page))).toBeInViewport({ ratio: 1 });
  });

  test('Offen, a long list scrolled down: opening the draft brings the page back to the top with its title (#248)', async ({ context, page }) => {
    const template = EMPTY_JETZT.find((task) => task.status === 0)!;
    const longOffen = Array.from({ length: 12 }, (_, i) => ({ ...template, id: `long-${i}`, title: `Long ${i}` }));
    await seedLocalBoard(context, longOffen);
    await page.goto('/tasks');
    await showColumnPage(page, 0);
    await offen(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(offen(page).locator('h2')).not.toBeInViewport();
    await headerAdd(page).evaluate((el: HTMLElement) => el.click());
    await expect(newCard(offen(page))).toBeInViewport({ ratio: 1 });
    await expect(offen(page).locator('h2')).toBeInViewport({ ratio: 1 });
    await expect(headerAdd(page)).toBeInViewport({ ratio: 1 });
  });

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('tapping the header button opens the draft card; cancelling brings the focus back', async ({ context, page }) => {
      await seedLocalBoard(context, EMPTY_JETZT);
      await page.goto('/tasks');
      await showColumnPage(page, 0);
      const add = headerAdd(page);
      expect((await box(add)).height).toBeGreaterThanOrEqual(44);
      await add.tap();
      await expect(newCard(offen(page))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(newCard(offen(page))).toHaveCount(0);
      await expect(add).toBeEnabled();
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
