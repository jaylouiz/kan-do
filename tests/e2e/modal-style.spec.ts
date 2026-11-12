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

// The foundations of DESIGN.md "States" and "Type" that the review of redesign slice 1 left open (kd#195):
// the disabled look does not stack, raw controls do not fade on a state change, Fraunces is a woff2.

test.describe('state language and fonts (kd#195)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('a disabled element inside another disabled-looking element stays at 50 %, not 25 %', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    const opacities = await page.evaluate(() => {
      const host = document.createElement('div')
      host.innerHTML = [
        '<button id="lone" disabled>lone</button>',
        '<div id="wrap" aria-disabled="true"><button id="nested" disabled>nested</button></div>',
        '<fieldset disabled><input id="fs" /></fieldset>',
      ].join('')
      document.body.append(host)
      // The effective opacity: the product of the element's own and its ancestors' computed values
      const effective = (id: string) => {
        let value = 1
        for (let el: Element | null = host.querySelector(`#${id}`); el; el = el.parentElement) value *= Number(getComputedStyle(el).opacity)
        return value
      }
      const result = { lone: effective('lone'), wrap: effective('wrap'), nested: effective('nested'), fieldset: effective('fs') }
      host.remove()
      return result
    })
    expect(opacities).toEqual({ lone: 0.5, wrap: 0.5, nested: 0.5, fieldset: 0.5 })
  })

  test('a raw button and a link do not transition opacity (the disabled look snaps)', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    const properties = await page.evaluate(() => {
      const host = document.createElement('div')
      host.innerHTML = '<button id="b">b</button><a id="a" href="#x">a</a><div id="r" role="button" tabindex="0">r</div>'
      document.body.append(host)
      const read = (id: string) => getComputedStyle(host.querySelector(`#${id}`)!).transitionProperty
      const result = { button: read('b'), link: read('a'), role: read('r') }
      host.remove()
      return result
    })
    for (const value of Object.values(properties)) {
      expect(value).toContain('background-color')
      expect(value).not.toContain('opacity')
    }
  })

  test('Fraunces comes from a woff2 file and the headings use it', async ({ page }) => {
    const fonts: { url: string; status: number; type: string }[] = []
    page.on('response', (response) => {
      if (/fraunces/i.test(response.url()) || /\.woff2?($|\?)/.test(response.url())) {
        fonts.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] ?? '' })
      }
    })
    await page.goto('/tasks')
    await expect(page.locator('h2').first()).toBeVisible()
    // Ask for the face outright: the load proves the file is served and decodes, whatever the page happens to render
    expect(await page.evaluate(async () => (await document.fonts.load('500 36px Fraunces')).length)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => [...document.fonts].some((face) => face.family.includes('Fraunces') && face.status === 'loaded'))).toBe(true)
    const fraunces = fonts.filter((font) => /fraunces/i.test(font.url) || font.url.endsWith('.woff2'))
    expect(fraunces.length).toBeGreaterThan(0)
    expect(fraunces.every((font) => font.status === 200 && !/\.ttf/i.test(font.url))).toBe(true)
  })
})
