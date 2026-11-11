import { test, expect, type Page } from '@playwright/test';
import { goToPlace, morePanel, openMore } from './helpers/appNav';
import { seedLocalBoard } from './helpers/seed';
import { elapseWindow, installClock } from './helpers/clock';

interface SeedRecord {
  /** Days before today. */
  ago: number;
  title?: string;
  taskId?: string;
  /** Percent of the timebox that was used (null = no timebox). */
  accuracy?: number | null;
  topic?: string | null;
  activity?: string | null;
  unplanned?: boolean;
}

/** Seeds completion records into the statistics store before page scripts run; dates are computed in the browser (local days). */
/** A work session on a local day: `from` / `to` as [hour, minute]. */
interface SeedSession { daysAgo: number, from: [number, number], to: [number, number] }

/** Eight weekdays (not today) with a session from 9:00 to 12:00 (#600). */
function weekdaySessions(count = 8): SeedSession[] {
  const list: SeedSession[] = [];
  for (let ago = 1; list.length < count; ago++) {
    const day = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - ago).getDay();
    if (day !== 0 && day !== 6) list.push({ daysAgo: ago, from: [9, 0], to: [12, 0] });
  }
  return list;
}

async function seedRecords(page: Page, records: SeedRecord[], extra: { dayEndDaysAgo?: Record<string, number>, discardedTime?: Array<{ taskId: string, daysAgo: number, seconds: number }>, workSessions?: SeedSession[] } = {}) {
  await page.addInitScript(({ list, extra }) => {
    const completionRecords = list.map((r, i) => {
      const at = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - r.ago, 10, i % 50);
      const boxed = r.accuracy !== null && r.accuracy !== undefined;
      return {
        taskId: r.taskId ?? `rec-${i}`,
        title: r.title ?? `Aufgabe ${i}`,
        completedAt: at.toISOString(),
        timeBoxSeconds: boxed ? 1800 : null,
        actualTimeSpentSeconds: boxed ? Math.round(18 * r.accuracy!) : 1800,
        estimationAccuracy: boxed ? r.accuracy : null,
        topic: r.topic ?? null,
        topicColorCode: null,
        activity: r.activity ?? null,
        isUnplanned: r.unplanned ?? false,
      };
    });
    // Legacy state (before #537) has neither field: they are written only when a test asks for them
    const stored: Record<string, unknown> = { completionRecords };
    const dayKeyAgo = (ago: number) => {
      const d = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - ago);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    if (extra.dayEndDaysAgo) stored.dayEndInFlight = Object.fromEntries(Object.entries(extra.dayEndDaysAgo).map(([ago, n]) => [dayKeyAgo(Number(ago)), n]));
    if (extra.discardedTime) stored.discardedTime = extra.discardedTime.map(r => ({ taskId: r.taskId, seconds: r.seconds, deletedAt: Date.now() - r.daysAgo * 86_400_000 }));
    if (extra.workSessions) {
      stored.workSessions = extra.workSessions.map(w => {
        const day = (h: number, m: number) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - w.daysAgo, h, m).getTime();
        return { start: day(...w.from), end: day(...w.to) };
      });
    }
    localStorage.setItem('taskStatistics', JSON.stringify(stored));
  }, { list: records, extra });
}

/**
 * A full history: 20 baseline tasks over 4 weeks (half within the timebox), 5 tasks in the last 7 days, all within
 * the timebox, plus one outlier and one more record that are tasks of the seeded board (so their detail opens; the page backfills the done Test Task 1 and drops its timebox).
 */
function fullHistory(): SeedRecord[] {
  const baseline: SeedRecord[] = Array.from({ length: 20 }, (_, i) => ({
    ago: i === 0 ? 34 : 8 + (i % 26),
    accuracy: i % 2 ? 150 : 100,
    topic: i % 2 ? 'Büro' : 'Feld',
    activity: 'Büro',
  }));
  const current: SeedRecord[] = Array.from({ length: 4 }, (_, i) => ({ ago: i, accuracy: 100, topic: 'Büro', activity: 'Büro' }));
  return [...baseline, ...current, { ago: 1, accuracy: 300, topic: 'Büro', activity: 'Büro', taskId: 'test-task-2', title: 'Test Task 2' }, { ago: 2, accuracy: 100, taskId: 'test-task-1', title: 'Test Task 1' }];
}

test.describe('Statistics Page', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    // Seeded before page JS runs (no goto + evaluate + reload, #512). A board with sources is onboarded:
    // no welcome redirect. Sample tasks: one Done, one in Progress.
    await seedLocalBoard(context, [
      { id: 'test-task-1', title: 'Test Task 1', status: 3, priority: 0, timeSpentSeconds: 1800, timeBoxSeconds: null, custom: {} },
      { id: 'test-task-2', title: 'Test Task 2', status: 1, priority: 0, timeSpentSeconds: 600, timeBoxSeconds: null, custom: {} },
    ]);
    await page.goto(baseURL!);
    await expect(page.locator('.board')).toBeVisible();
  });

  test('should navigate to statistics page via the app bar', async ({ page }) => {
    // Statistik is a place in the app bar (#470)
    await goToPlace(page, 'Statistik');
    await expect(page).toHaveURL(/\/statistics/);
    await expect(page.locator('h1')).toContainText('Statistik');
  });

  test('no visible page header: the bar names the page, the title stays as an sr-only h1 (#686)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/statistics`);
    await expect(page.getByTestId('stats-verdict')).toBeVisible();
    await expect(page.locator('header.page-header')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Statistik' })).toHaveClass(/sr-only/);
    await expect(page.getByText('Wie es läuft und wohin deine Zeit geht')).toHaveCount(0);
  });

  test('has no sync button of its own; sync stays in the Mehr panel (#670)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/statistics`);
    await expect(page.getByTestId('stats-verdict')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archivierte Aufgaben synchronisieren' })).toHaveCount(0);
    await openMore(page);
    await expect(morePanel(page).getByTestId('more-sync')).toBeVisible();
  });

  test('should leave the statistics page with the browser back (no back arrow, #470)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/statistics`);
    await expect(page.getByRole('link', { name: 'Zurück' })).toHaveCount(0);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/statistics/);
  });

  test('has no period filter and ignores the legacy links', async ({ page, baseURL }) => {
    await seedRecords(page, fullHistory());
    for (const query of ['', '?timeFrame=all', '?section=metrics']) {
      await page.goto(`${baseURL}/statistics${query}`);
      await expect(page.getByTestId('stats-verdict')).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Zeitraum/ })).toHaveCount(0);
      await expect(page.locator('table')).toHaveCount(0); // the list is collapsed
    }
  });

  test.describe('states', () => {
    test('empty: the verdict surface and the first-run work-rhythm tile, no question tiles and no zeros', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByRole('heading', { level: 2, name: 'Noch nichts zu vergleichen.' })).toBeVisible();
      await expect(page.getByText('Erledigte Aufgaben mit Timebox füllen diese Seite.')).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2); // the verdict and tile 5 (#600)
      await expect(page.getByTestId('stats-tile-2')).toHaveCount(0);
      // only the ring's bare outline, decorative (kd#106): one track circle, no segment, no text alternative
      await expect(page.getByTestId('stats-verdict').locator('svg')).toHaveCount(1);
      await expect(page.getByTestId('stats-verdict-placeholder').locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.getByTestId('stats-verdict-placeholder').locator('circle')).toHaveCount(1);
      await expect(page.getByTestId('stats-all-tasks')).toHaveCount(0);
    });

    test('thin history: says so with the baseline count, tiles show what exists', async ({ page, baseURL }) => {
      await seedRecords(page, [{ ago: 0, accuracy: 100, topic: 'Büro' }, { ago: 1, accuracy: 120, topic: 'Büro' }]);
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-verdict-headline')).toHaveText('Noch zu wenig Verlauf für einen Vergleich.');
      await expect(page.getByTestId('stats-verdict-line')).toContainText('In den 28 Tagen vor den letzten 7 Tagen: 0 erledigte Aufgaben.');
      await expect(page.getByTestId('stats-verdict').locator('svg')).toHaveCount(0); // #687
      await expect(page.getByTestId('stats-tile-2')).toContainText('Noch zu wenige Wochen für eine Entwicklung.');
      await expect(page.getByTestId('stats-tile-3')).toContainText('Noch zu wenige erledigte Aufgaben mit Timebox für Muster.');
    });

    test('no timebox at all: Q3 is a plain heading without a toggle', async ({ page, baseURL }) => {
      await seedRecords(page, [{ ago: 0, topic: 'Büro' }, { ago: 1, topic: 'Büro' }]);
      await page.goto(`${baseURL}/statistics?open=3`);
      const tile = page.getByTestId('stats-tile-3');
      await expect(tile).toContainText('Ohne Timebox gibt es keinen Vergleich. Setze beim nächsten Mal eine.');
      await expect(tile.getByRole('heading', { level: 2, name: /Wo schätze ich falsch\?/ })).toBeVisible();
      await expect(tile.getByRole('button')).toHaveCount(0);
    });

    test('quiet week: a plain statement and no verdict word', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory().filter(r => r.ago >= 8));
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-verdict-headline')).toHaveText('In den letzten 7 Tagen wurde nichts erledigt.');
      await expect(page.getByTestId('stats-verdict-line')).toContainText('im Schnitt');
    });
  });

  test.describe('work rhythm tile (#600)', () => {
    test('first run: the tile explains, counts the days and has no toggle, also on an empty page', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics`);
      const tile = page.getByTestId('stats-tile-5');
      await expect(tile.getByRole('heading', { level: 2, name: 'Wann arbeite ich?' })).toBeVisible();
      await expect(tile).toContainText('Noch zu wenig Daten. Kan-Do merkt sich ab jetzt, wann der Timer läuft.');
      await expect(page.getByTestId('stats-rhythm-days')).toHaveText('0 von 5 Tagen');
      await expect(tile.getByRole('button')).toHaveCount(0);
      await expect(tile.locator('[data-testid="stats-rhythm-ghost"]')).toHaveAttribute('aria-hidden', 'true');
    });

    test('old stored data without the field still loads: first-run tile next to a full history', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory());
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-tile-2')).toBeVisible();
      await expect(page.getByTestId('stats-rhythm-days')).toHaveText('0 von 5 Tagen');
      await expect(page.getByTestId('stats-tile-5')).not.toContainText(/\d \/ \d/);
    });

    test('four days are still first run and count them', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory(), { workSessions: weekdaySessions(4) });
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-rhythm-days')).toHaveText('4 von 5 Tagen');
    });

    test('with sessions: sentence, bars, grid and rows; opens in place, one at a time with the question tiles', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory(), { workSessions: weekdaySessions() });
      await page.goto(`${baseURL}/statistics`);
      const tile = page.getByTestId('stats-tile-5');
      await expect(tile).toContainText(/Meist zwischen 9 und 12 Uhr, dort liegen 100\s%\sdeiner Zeit\. Du fängst an Werktagen meist um 0?9:00 an\./);
      await expect(tile.getByTestId('stats-rhythm-bar')).toHaveCount(16);
      await expect(tile.locator('[data-peak="true"]')).toHaveCount(3);
      await expect(tile.getByRole('img')).toHaveAttribute('aria-label', /9 und 12 Uhr/);

      await page.getByTestId('stats-tile-2-toggle').click();
      await page.getByTestId('stats-tile-5-toggle').click();
      await expect(page.getByTestId('stats-tile-5-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('stats-tile-2-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(tile.getByRole('heading', { level: 3, name: 'Durchschnittlich pro Stunde, letzte 8 Wochen' })).toBeVisible();
      await expect(tile.getByTestId('stats-rhythm-cell')).toHaveCount(7 * 16);
      await expect(tile.getByTestId('stats-rhythm-grid')).toHaveAttribute('aria-label', /Meiste Zeit zwischen 9 und 12 Uhr/);
      await expect(tile.getByTestId('stats-rhythm-rows')).toContainText('Beginn, meist um');
      await expect(tile.getByTestId('stats-rhythm-rows')).toContainText('Ende, meist um');
      await expect(tile.getByTestId('stats-rhythm-rows')).toContainText('Am längsten arbeitest du am');
      expect(await page.getByTestId('stats-tile-5').evaluate(el => el === el.parentElement!.lastElementChild)).toBe(true);

      await page.getByTestId('stats-tile-5-toggle').press('Escape');
      await expect(page.getByTestId('stats-tile-5-toggle')).toHaveAttribute('aria-expanded', 'false');
    });

    test('at 390px the open tile stays inside the viewport', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await seedRecords(page, fullHistory(), { workSessions: weekdaySessions() });
      await page.goto(`${baseURL}/statistics?open=5`);
      await expect(page.getByTestId('stats-tile-5-toggle')).toHaveAttribute('aria-expanded', 'true');
      const box = await page.getByTestId('stats-rhythm-grid').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });

  test.describe('with a full history', () => {
    test.beforeEach(async ({ page }) => {
      await seedRecords(page, fullHistory());
    });

    test('answers its questions in order, against the user\'s own usual', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-verdict-headline')).toHaveText('Es läuft besser als sonst.');
      await expect(page.getByTestId('stats-verdict-line')).toContainText('davon in der Timebox (sonst');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        /Es läuft besser als sonst\./,
        /Wie entwickle ich mich\?/,
        /Wo schätze ich falsch\?/,
        /Wofür nehme ich mir Zeit\?/,
        /Wann arbeite ich\?/,
      ]);
      // No step label ("n / n") on any tile (D3 on #600)
      await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /\d \/ \d/ })).toHaveCount(0);
      await expect(page.getByTestId('stats-verdict')).not.toContainText(/\d \/ \d/);
      // The ring states its numbers
      await expect(page.getByTestId('stats-verdict').getByRole('img')).toHaveAttribute('aria-label', /In der Timebox erledigt: \d+ %, sonst \d+ %/);
      // No status colour on the page
      await expect(page.locator('main .text-error, main .text-warning, main .text-success, main .bg-error, main .bg-warning, main .bg-success')).toHaveCount(0);
    });

    test('a tile opens in place with the keyboard, one at a time, and focus stays on its toggle', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics`);
      const toggle = (n: number) => page.getByTestId(`stats-tile-${n}-toggle`);

      await toggle(4).focus();
      await page.keyboard.press('Enter');
      await expect(toggle(4)).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle(4)).toBeFocused();
      await expect(page.getByTestId('stats-split-rows')).toBeVisible();

      // the open tile 4 is first in reading order, before 2 and 3 (no CSS order)
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        /Es läuft/, /Wofür nehme ich mir Zeit\?/, /Wie entwickle ich mich\?/, /Wo schätze ich falsch\?/, /Wann arbeite ich\?/,
      ]);

      // opening another closes the first; focus follows the toggle that was used
      await toggle(2).focus();
      await page.keyboard.press('Space');
      await expect(toggle(2)).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle(4)).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle(2)).toBeFocused();
      await expect(page.getByTestId('stats-week-list')).toBeVisible();

      // Esc closes the open tile and the order returns to the natural one
      await page.keyboard.press('Escape');
      await expect(toggle(2)).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle(2)).toBeFocused();
      await expect(page.getByTestId('stats-week-list')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        /Es läuft/, /Wie entwickle ich mich\?/, /Wo schätze ich falsch\?/, /Wofür nehme ich mir Zeit\?/, /Wann arbeite ich\?/,
      ]);
    });

    test('Q4 switches between topic and activity', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics?open=4`);
      const rows = page.getByTestId('stats-split-rows');
      await expect(rows).toContainText('Büro');
      await expect(rows).toContainText('Feld');
      await page.getByRole('tab', { name: 'Aktivität' }).click();
      await expect(rows).toContainText('Büro');
      await expect(rows).not.toContainText('Feld');
    });

    test('Q3 names the patterns and an outlier opens the task detail', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics?open=3`);
      await expect(page.getByTestId('stats-patterns')).toContainText('länger als geplant');
      await expect(page.getByTestId('stats-patterns')).toContainText('Nächste Timebox');
      await page.getByTestId('stats-outliers').getByRole('button', { name: /Test Task 2/ }).click();
      // The board's task sheet over the statistics page (kd#179): its own route, the page stays under it
      await expect(page).toHaveURL(/\/statistics\/test-task-2$/);
      await expect(page.getByRole('dialog', { name: 'Test Task 2' })).toBeVisible();
      await expect(page.getByTestId('task-detail-header')).toBeVisible();
      await expect(page.getByTestId('stats-patterns')).toBeVisible();
    });

    test('all completed tasks sit behind one disclosure and keep the drill-down', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics`);
      const list = page.getByTestId('stats-all-tasks');
      await expect(list.getByText(/Alle erledigten Aufgaben \(26\)/)).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);
      await list.getByText(/Alle erledigten Aufgaben/).click();
      await expect(list.getByText('Test Task 1')).toBeVisible();
      await list.getByText('Test Task 1').click();
      await expect(page).toHaveURL(/\/statistics\/test-task-1$/);
      await expect(page.getByRole('dialog', { name: 'Test Task 1' })).toBeVisible();
    });

    test('the sheet closes like the board\'s: Escape lands on /statistics and focus returns to the outlier, Back does the same (kd#179)', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics?open=3`);
      const outlier = page.getByTestId('stats-outliers').getByRole('button', { name: /Test Task 2/ });
      await outlier.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Test Task 2' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/statistics(\?open=3)?$/);
      await expect(outlier).toBeFocused();
      // the open tile is still open under the closed sheet
      await expect(page.getByTestId('stats-patterns')).toBeVisible();

      await outlier.click();
      await expect(page.getByRole('dialog', { name: 'Test Task 2' })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/statistics(\?open=3)?$/);
    });

    test('a reload on /statistics/<id> shows the page with the sheet open; an unknown task shows the not-found state', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/statistics/test-task-1`);
      await expect(page.getByTestId('stats-verdict')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Test Task 1' })).toBeVisible();
      await page.goto(`${baseURL}/statistics/does-not-exist`);
      await expect(page.getByTestId('task-not-found')).toBeVisible();
    });
  });

  test.describe('data that needs new fields (#537)', () => {
    test('Q2 shows the average open tasks at day end per week, a dash below 3 days, and old data renders with dashes', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory(), { dayEndDaysAgo: { 0: 6, 1: 3, 2: 4, 9: 5, 10: 5 } });
      await page.goto(`${baseURL}/statistics?open=2`);
      const cells = page.getByTestId('stats-week-day-end');
      await expect(cells).toHaveCount(8);
      await expect(cells.first()).toHaveText('im Schnitt 4,3 offen am Tagesende');
      await expect(cells.nth(1)).toHaveText('Offen am Tagesende –'); // two days only
      await expect(page.getByTestId('stats-week-list')).not.toContainText('im Schnitt 0');
    });

    test('a state stored before the fields existed loads, shows dashes, and Q4 names only the open work', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory().filter(r => r.taskId === undefined));
      await page.goto(`${baseURL}/statistics?open=2`);
      await expect(page.getByTestId('stats-week-day-end')).toHaveText(Array(8).fill('Offen am Tagesende –'));
      await page.getByTestId('stats-tile-4-toggle').click();
      // the seeded board has one task in Jetzt with tracked time: it is the only unfinished part
      await expect(page.getByTestId('stats-unfinished')).toHaveText(/^Nicht eingerechnet: .+ auf offenen Aufgaben\.$/);
    });

    test('Q4 names the time on deleted tasks of the last 4 weeks and leaves older ones out', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory(), { discardedTime: [{ taskId: 'g1', daysAgo: 3, seconds: 3900 }, { taskId: 'g2', daysAgo: 40, seconds: 99_000 }] });
      await page.goto(`${baseURL}/statistics?open=4`);
      await expect(page.getByTestId('stats-unfinished')).toContainText('1 h 5 min auf gelöschten (letzte 4 Wochen).');
      await expect(page.getByTestId('stats-unfinished')).not.toContainText('27 h');
    });
  });

  test.describe('390px viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a task opens in the bottom drawer, not a centred modal (kd#179)', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory());
      await page.goto(`${baseURL}/statistics?open=3`);
      await page.getByTestId('stats-outliers').getByRole('button', { name: /Test Task 2/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Test Task 2' });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(/\/statistics\/test-task-2$/);
      await page.waitForTimeout(500);
      const box = await dialog.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(388);
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(843);
    });

    test('one column in the same order, an open tile keeps its place, no horizontal scroll', async ({ page, baseURL }) => {
      await seedRecords(page, fullHistory());
      await page.goto(`${baseURL}/statistics`);
      await expect(page.getByTestId('stats-verdict')).toBeVisible();

      await page.getByTestId('stats-tile-4-toggle').click();
      await expect(page.getByTestId('stats-tile-4-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        /Es läuft/, /Wie entwickle ich mich\?/, /Wo schätze ich falsch\?/, /Wofür nehme ich mir Zeit\?/, /Wann arbeite ich\?/,
      ]);

      await page.getByTestId('stats-tile-2-toggle').click();
      await expect(page.getByTestId('stats-week-list')).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // the toggle row is a touch target of at least 44px
      const box = await page.getByTestId('stats-tile-2-toggle').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  });
});

test.describe('deleting a task with tracked time (#537)', () => {
  test('after the undo window the deleted time shows in Q4, and an undo inside it leaves nothing', async ({ page, context, baseURL }) => {
    await installClock(context);
    await seedLocalBoard(context, [
      { id: 'tracked-1', title: 'Getrackte Aufgabe', status: 0, priority: 0, timeSpentSeconds: 5400, timeBoxSeconds: null, custom: {} },
      { id: 'tracked-2', title: 'Zweite Aufgabe', status: 0, priority: 0, timeSpentSeconds: 600, timeBoxSeconds: null, custom: {} },
    ]);
    await seedRecords(page, fullHistory().filter(r => r.taskId === undefined));
    await page.goto(`${baseURL}/tasks`);
    const card = (title: string) => page.locator('.task-wrapper', { hasText: title }).first();
    const remove = async (title: string) => {
      await card(title).locator('.task').click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Löschen/ }).first().click();
    };

    await remove('Zweite Aufgabe');
    await page.getByTestId('gap-undo').click(); // undo inside the window
    await remove('Getrackte Aufgabe');
    await elapseWindow(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('taskStatistics') ?? '{}').discardedTime?.map((r: { taskId: string }) => r.taskId))).toEqual(['tracked-1']);

    await goToPlace(page, 'Statistik'); // in-app navigation: a reload would re-run the seed
    await page.getByTestId('stats-tile-4-toggle').click();
    await expect(page.getByTestId('stats-unfinished')).toContainText('1 h 30 min auf gelöschten (letzte 4 Wochen)');
  });
});
