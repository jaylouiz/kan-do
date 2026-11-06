#!/usr/bin/env node
/**
 * Opt-in motion check for stack (un)collapse and similar script animations (#578). NOT part of
 * `test:e2e` or the pre-merge gate: run it by hand while building an animation issue.
 *
 *   npm run motion:film -- --out <dir> [--base http://localhost:3101] [--group topic|priority]
 *                          [--frames 12] [--max-step 24] [--tolerance 1] [--widths 1280,390]
 *
 * Needs a running server (`PORT=3101 npm run dev`, or a built one) and the repo's playwright chromium.
 * For every width and every stack of the first grouped column it expands the stack and collapses it
 * again; each beat is paused by a MutationObserver the moment `data-stack-animating` is set (before
 * the first frame renders), then seeked to N points (0 % to 100 %) instead of run in real time.
 * Output in `--out`: a filmstrip PNG per beat, the frames, and a report on stdout. Exit code 1 when
 * a check flags something.
 *
 * Checks (per animated element, between neighbouring points):
 *  - jump: its box moves by more than `--max-step` px AND more than 45 % of its whole path (a
 *    teleport; a legitimately fast ease stays under the share)
 *  - pop: its opacity steps by more than 0.5, i.e. it appears or vanishes at (nearly) full opacity
 *    within one point
 *  - endpoints: pixel diff of the first point against the resting frame before the click and of the
 *    last point against the resting frame after the beat, in % of pixels (`--tolerance`)
 *
 * Research behind it (Specify of #578):
 *  - Seek to fixed times instead of waiting: the Web Animations spec recommends it for tests, so the
 *    result does not depend on machine load (a requestAnimationFrame sampler records whatever frames
 *    the machine delivered). https://www.w3.org/TR/2015/WD-web-animations-1-20150707
 *  - `pause()` is asynchronous: wait for `animation.ready` before reading or setting `currentTime`.
 *    https://searchfox.org/mozilla-central/source/testing/web-platform/tests/web-animations/interfaces/Animation/pause.html
 *  - Only transform and opacity run on the compositor. What this script cannot show is frame rate
 *    on a real device: record the beat in Chrome DevTools "Performance" with 4x CPU throttling and
 *    check that frames show no Layout or Paint bands and the dropped-frame share stays low.
 *    https://web.dev/animations-guide/
 *  - Playwright's `page.clock` does not drive `document.timeline` (microsoft/playwright#38951), so
 *    fake time is no alternative to seeking.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from 'playwright'

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3101' },
    out: { type: 'string' },
    group: { type: 'string', default: 'topic' },
    frames: { type: 'string', default: '12' },
    'max-step': { type: 'string', default: '24' },
    tolerance: { type: 'string', default: '1' },
    widths: { type: 'string', default: '1280,390' },
  },
})
if (!values.out) throw new Error('--out <dir> is required (a scratch directory, never inside the repo)')
const OUT = values.out
const FRAMES = Number(values.frames)
const MAX_STEP = Number(values['max-step'])
const TOLERANCE = Number(values.tolerance)
const LIST = '#column-open-list'
mkdirSync(OUT, { recursive: true })

interface Sample { id: string, box: [number, number, number, number], opacity: number }
const problems: string[] = []

/** Script animations only (the motion); CSS transitions elsewhere on the page are not the beat */
const pauseHook = () => {
  const list = document.querySelector('#column-open-list')!
  new MutationObserver(() => {
    if (list.getAttribute('data-stack-animating') === null) return
    for (const animation of document.getAnimations()) {
      if (animation instanceof CSSTransition || animation instanceof CSSAnimation) continue
      animation.pause()
    }
  }).observe(list, { attributes: true, attributeFilter: ['data-stack-animating'] })
}

async function seek(page: Page, fraction: number): Promise<Sample[]> {
  return page.evaluate(async (at) => {
    const animations = document.getAnimations().filter(a => !(a instanceof CSSTransition || a instanceof CSSAnimation))
    for (const animation of animations) {
      const end = Number(animation.effect!.getComputedTiming().endTime)
      animation.currentTime = Math.min(end * at, end - 0.01)
    }
    await Promise.all(animations.map(a => a.ready))
    const describe = (el: Element) => {
      const pieces: string[] = []
      for (let node: Element | null = el; node && pieces.length < 3; node = node.parentElement) {
        pieces.unshift(node.getAttribute('data-task-id') ?? node.getAttribute('data-stack-header') ?? node.getAttribute('data-stack-key')
          ?? ((node.className && typeof node.className === 'string') ? node.className.split(' ')[0] : node.tagName.toLowerCase()) ?? '')
        if (node.hasAttribute('data-task-id') || node.hasAttribute('data-stack-header') || node.hasAttribute('data-stack-key')) break
      }
      return pieces.join('>')
    }
    const seen = new Map<Element, number>()
    return animations.map((animation) => {
      const target = (animation.effect as KeyframeEffect).target!
      const n = (seen.get(target) ?? 0) + 1
      seen.set(target, n)
      const rect = target.getBoundingClientRect()
      return {
        id: `${describe(target)}#${n}`,
        box: [rect.x, rect.y, rect.width, rect.height] as [number, number, number, number],
        opacity: Number(getComputedStyle(target).opacity),
      }
    })
  }, fraction)
}

function judge(label: string, frames: Sample[][]) {
  const ids = new Set(frames.flatMap(f => f.map(s => s.id)))
  for (const id of ids) {
    const track = frames.map(f => f.find(s => s.id === id))
    const boxes = track.map(s => s?.box)
    const centre = (b: [number, number, number, number]) => [b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3]]
    const dist = (a: number[], b: number[]) => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!), Math.abs(a[3]! - b[3]!))
    let path = 0
    for (let i = 1; i < boxes.length; i++) if (boxes[i] && boxes[i - 1]) path += dist(centre(boxes[i]!), centre(boxes[i - 1]!))
    for (let i = 1; i < track.length; i++) {
      const [a, b] = [track[i - 1], track[i]]
      if (a && b) {
        const step = dist(centre(a.box), centre(b.box))
        if (step > MAX_STEP && step > 0.45 * path) problems.push(`${label} ${id}: jump of ${step.toFixed(0)}px between points ${i - 1} and ${i} (path ${path.toFixed(0)}px)`)
        if (Math.abs(a.opacity - b.opacity) > 0.5) problems.push(`${label} ${id}: opacity ${a.opacity.toFixed(2)} -> ${b.opacity.toFixed(2)} between points ${i - 1} and ${i}`)
      } else if ((a ?? b)!.opacity > 0.5) {
        problems.push(`${label} ${id}: ${a ? 'vanishes' : 'appears'} at opacity ${(a ?? b)!.opacity.toFixed(2)} at point ${a ? i : i - 1}`)
      }
    }
  }
}

/**
 * Percent of pixels (any channel off by more than 48: text anti-aliasing on a transformed layer stays below that)
 * that differ between two PNGs, compared in the browser. It flags gross mismatches (a card, the wash or a whole
 * layer missing or extra); a small object such as the pill is only ~0.3 % of a frame, so it is covered by the jump
 * and pop checks and by the E2E assertions of #578 instead.
 */
async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(async ([x, y]) => {
    const load = async (b64: string) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = new OffscreenCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, img.width, img.height)
    }
    const [p, q] = await Promise.all([load(x!), load(y!)])
    if (p.width !== q.width || p.height !== q.height) return 100
    let off = 0
    for (let i = 0; i < p.data.length; i += 4) {
      if (Math.abs(p.data[i]! - q.data[i]!) > 48 || Math.abs(p.data[i + 1]! - q.data[i + 1]!) > 48 || Math.abs(p.data[i + 2]! - q.data[i + 2]!) > 48) off++
    }
    return (off / (p.width * p.height)) * 100
  }, [a.toString('base64'), b.toString('base64')])
}

const browser = await chromium.launch()
try {
  const tool = await (await browser.newContext()).newPage()
  for (const width of String(values.widths).split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 1200 : 1500 }, locale: 'de-DE' })
    const page = await context.newPage()
    await context.addInitScript(() => { localStorage.setItem('kando-locale', 'de') })
    await page.goto(`${values.base}/tasks?seed=demo`)
    await page.locator(LIST).waitFor()
    await page.evaluate((key) => {
      const board = JSON.parse(localStorage.getItem('board-store')!)
      board.grouping = { enabled: true, key }
      localStorage.setItem('board-store', JSON.stringify(board))
    }, values.group)
    await page.goto(`${values.base}/tasks`)
    await page.locator(`${LIST} .task-stack`).first().waitFor()
    await page.evaluate(pauseHook)
    const keys = await page.locator(`${LIST} .task-stack`).evaluateAll(els => els.map(el => el.getAttribute('data-stack-key')!))
    // One fixed region for every shot of a beat (the list grows on expand): from the list's top to the viewport bottom
    const clip = async () => {
      const box = (await page.locator(LIST).boundingBox())!
      const height = (page.viewportSize()!.height) - box.y
      return { x: box.x, y: box.y, width: box.width, height }
    }

    for (const key of keys) {
      const stack = page.locator(`${LIST} .task-stack[data-stack-key="${key}"]`)
      const close = page.locator(`${LIST} [data-stack-header="${key}"] button`)
      for (const kind of ['expand', 'collapse'] as const) {
        const label = `${width}px ${key} ${kind}`
        const rest = async () => {
          await page.evaluate(() => document.getAnimations().forEach(a => a.finish()))
          await page.waitForFunction(() => !document.querySelector('[data-stack-animating]'))
          await page.mouse.move(0, 0)
          return page.screenshot({ clip: await clip() })
        }
        // A collapse starts where the expand before it ended
        const before = await rest()
        const clipBefore = await clip()
        // A synthetic pointer click: a real mouse would leave the pointer hovering (lifted card, shadow) in the frames but not in the resting frames
        await (kind === 'expand' ? stack : close).evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
        await page.waitForFunction(() => document.querySelector('[data-stack-animating]') !== null)
        const clipBox = clipBefore
        const shots: Buffer[] = []
        const samples: Sample[][] = []
        for (let i = 0; i < FRAMES; i++) {
          samples.push(await seek(page, i / (FRAMES - 1)))
          shots.push(await page.screenshot({ clip: clipBox }))
        }
        judge(label, samples)
        const after = await rest()
        const first = await pixelDiff(tool, shots[0]!, before)
        const last = await pixelDiff(tool, shots[FRAMES - 1]!, after)
        const note = `first point vs resting before: ${first.toFixed(2)} %, last point vs resting after: ${last.toFixed(2)} %`
        console.log(`${label}: ${samples[0]!.length} animations, ${note}`)
        if (first > TOLERANCE) problems.push(`${label}: first point differs from the resting frame before (${first.toFixed(2)} % > ${TOLERANCE} %)`)
        if (last > TOLERANCE) problems.push(`${label}: last point differs from the resting frame after (${last.toFixed(2)} % > ${TOLERANCE} %)`)

        const base = `${width}-${key.replace(/\W+/g, '_')}-${kind}`
        writeFileSync(join(OUT, `${base}-before.png`), before)
        writeFileSync(join(OUT, `${base}-after.png`), after)
        shots.forEach((shot, i) => writeFileSync(join(OUT, `${base}-${String(i).padStart(2, '0')}.png`), shot))
        // Contact sheet: the 12 points and the resting frame, 7 per row, top 700 px of each
        const cell = Math.round(clipBox.width)
        await tool.setViewportSize({ width: 7 * (cell + 4), height: 800 })
        await tool.setContent(`<body style="margin:0;background:#fff;display:flex;flex-wrap:wrap;gap:4px">${[...shots, after].map(s => `<img style="width:${cell}px;height:700px;object-fit:none;object-position:top" src="data:image/png;base64,${s.toString('base64')}">`).join('')}</body>`)
        writeFileSync(join(OUT, `${base}-strip.png`), await tool.screenshot({ fullPage: true }))
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n${problems.map(p => `- ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('\nno jumps, pops or endpoint differences flagged')
