#!/usr/bin/env node
/**
 * Opt-in performance measurement of the board (#275). NOT part of `test:e2e`, `verify` or the pre-merge gate:
 * run it by hand before and after a change that should make the app lighter, and put both tables in the PR.
 *
 *   npm run perf:audit -- --base http://localhost:3103 [--seed-from <url>] [--seed-file <file>]
 *                         [--only load,rest,sheet,drag,tick] [--runs 5] [--throttle 4] [--json <file>]
 *
 * Needs a served build and the repo's playwright chromium. Measure a real production build, never `nuxt dev`
 * (unminified modules, no chunks):
 *   - `npm run build`, then serve `.output/public` with any static server that falls back to `200.html`, or
 *   - `PORT=<port> node scripts/e2e-server.mjs` (the E2E build: it has the seed plugin, plus the copy editor and
 *     /ui, so its bundle is a little larger than what ships).
 * The board state comes from `?seed=demo` (plugins/e2e-seed.client.ts). A real production build has no seed plugin:
 * pass `--seed-from <url of a build that has it>` and the script copies the seeded state into the measured build.
 * With one port only, keep the state in a file: `--seed-file <file>` writes it on the first run (against the build
 * with the plugin) and reads it on every later run (a scratch file, never inside the repo; the seed holds today's
 * dates, so make a new one each day).
 *
 * What it reports (counts are stable between runs; timings move by up to a third on a busy machine, so compare counts):
 *   load   first load of /tasks at `--throttle`x CPU: requests and transferred kB (JS, fonts), first contentful
 *          paint, the longest main-thread task, total blocking time; on the demo board and a 73-task board
 *   rest   a board nobody touches, per second, no throttle: main-thread frames, layouts, frame callbacks and
 *          main-thread time; without a task in Jetzt, with one, and with the focus overlay lit (the app default)
 *   sheet  opening a task sheet on the 73-task board: restyled elements, whole-page restyles, style time
 *   drag   one drag from Offen to Wartet on the 73-task board: the same three numbers
 *   tick   main-thread time of the one-second timer tick, on 13, 73 and 613 tasks
 *
 * A "whole-page restyle" is one style recalculation that touches more than half of the document's elements: the
 * sign of a selector that keeps the whole page in its scope (`html:has(…)`, a universal rule in an injected sheet).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3103' },
    'seed-from': { type: 'string' },
    'seed-file': { type: 'string' },
    only: { type: 'string', default: 'load,rest,sheet,drag,tick' },
    runs: { type: 'string', default: '5' },
    throttle: { type: 'string', default: '4' },
    json: { type: 'string' },
  },
})
const BASE = args.base.replace(/\/$/, '')
const RUNS = Number(args.runs)
const RATE = Number(args.throttle)
const ONLY = new Set(args.only.split(','))
const VIEWPORT = { width: 1280, height: 800 }

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = (x, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits
const kB = bytes => round(bytes / 1024)

// ---- board state ---------------------------------------------------------------------------------------------------

/** The localStorage a `?seed=demo` load leaves behind (13 tasks, one in Jetzt, the focus overlay off). */
async function readDemoSeed(browser) {
  const file = args['seed-file']
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const from = (args['seed-from'] ?? BASE).replace(/\/$/, '')
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'de-DE' })
  const page = await context.newPage()
  await page.goto(`${from}/tasks?seed=demo`)
  try {
    await page.locator('.task-wrapper').first().waitFor({ state: 'visible', timeout: 20000 })
  } catch {
    throw new Error(`no seeded board at ${from}/tasks?seed=demo: this build has no seed plugin, pass --seed-from <url of one that has>`)
  }
  const seed = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
  await context.close()
  if (file) writeFileSync(file, JSON.stringify(seed))
  return seed
}

/** Variants of the demo board: extra tasks spread over Offen, Wartet and Erledigt, the overlay setting, an empty Jetzt. */
function boardState(seed, { extra = 0, focus = false, emptyJetzt = false } = {}) {
  const state = structuredClone(seed)
  const board = JSON.parse(state['board-store'])
  const tasks = JSON.parse(state['tasks-store'])
  const order = status => board.columns.find(column => column.taskStatus === status).taskOrder
  const now = new Date().toISOString()
  const topics = ['Baustelle Müller', 'Angebote', 'Personal', 'Fuhrpark', 'Buchhaltung', null]
  const add = (status, count) => {
    for (let i = 0; i < count; i++) {
      const id = `perf-${status}-${i}`
      tasks.tasks.push({
        id, source: 'local', externalId: null, status, title: `Aufgabe ${status}-${i} mit einem etwas längeren Titel`,
        activity: i % 3 ? 'Büro' : 'Vor Ort', topic: topics[i % topics.length], topicColorCode: null, priority: (i % 3) + 1,
        notes: i % 2 ? 'Eine Notiz.\n\n- Punkt eins\n- Punkt zwei' : null, timeBoxSeconds: i % 2 ? 1800 : null,
        timeSpentSeconds: status === 3 ? 1500 : 0, timerId: null, custom: {}, completedAt: status === 3 ? now : null,
        createdAt: now, updatedAt: now, archivedAt: null, isUnplanned: false,
      })
      order(status).push(id)
    }
  }
  add(0, Math.round(extra / 2))
  add(2, Math.round(extra / 6))
  add(3, Math.round(extra / 3))
  if (emptyJetzt) {
    for (const task of tasks.tasks) if (task.status === 1) task.status = 0
    order(0).push(...order(1).splice(0))
  }
  state['board-store'] = JSON.stringify(board)
  state['tasks-store'] = JSON.stringify(tasks)
  state['settings-store'] = JSON.stringify({ focusEnabled: focus })
  return state
}
const LARGE = { extra: 60 }

// ---- page plumbing -------------------------------------------------------------------------------------------------

const INIT = (state) => {
  for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value)
  const marks = (window.__perf = { longTasks: [] })
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) marks.longTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* no longtask support: the columns stay empty */ }
}

async function open(browser, state, { throttle = 1 } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'de-DE' })
  await context.addInitScript(INIT, state)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Network.enable')
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  const requests = new Map()
  cdp.on('Network.responseReceived', event => requests.set(event.requestId, { url: event.response.url, bytes: 0 }))
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId)
    if (request) request.bytes = event.encodedDataLength
  })
  const go = async () => {
    await page.goto(`${BASE}/tasks`)
    await page.locator('.task-wrapper').first().waitFor({ state: 'visible', timeout: 60000 })
  }
  return { context, page, cdp, requests, go }
}

const metricsOf = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))

/** Runs `act` under a trace and returns the trace events. */
async function traced(cdp, act) {
  const events = []
  const collect = event => events.push(...event.value)
  cdp.on('Tracing.dataCollected', collect)
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] },
  })
  await act()
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.end')
  await complete
  cdp.off('Tracing.dataCollected', collect)
  return events
}

/** Style work in a trace: every recalculation's element count, against the size of the document. */
function styleWork(events, nodes) {
  const recalcs = events.filter(event => event.name === 'UpdateLayoutTree' && event.ph === 'X')
  return {
    restyledElements: recalcs.reduce((sum, event) => sum + (event.args?.elementCount ?? 0), 0),
    wholePageRestyles: recalcs.filter(event => (event.args?.elementCount ?? 0) > nodes / 2).length,
    styleMs: round(recalcs.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000),
  }
}
const nodeCount = page => page.evaluate(() => document.querySelectorAll('*').length)
const settled = page => page.evaluate(async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const finite = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
  await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)))
})
const medianRow = rows => Object.fromEntries(Object.keys(rows[0]).map(key => [key, round(median(rows.map(row => row[key])))]))

// ---- scenarios -----------------------------------------------------------------------------------------------------

async function load(browser, state) {
  const rows = []
  let transfer = null
  for (let run = 0; run < RUNS; run++) {
    const session = await open(browser, state, { throttle: RATE })
    await session.go()
    await session.page.waitForTimeout(1500) // the first fetch and lazy chunks belong to the load
    const marks = await session.page.evaluate(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
      longTasks: window.__perf.longTasks,
    }))
    rows.push({
      firstContentfulPaintMs: marks.fcp,
      longestTaskMs: Math.max(0, ...marks.longTasks),
      totalBlockingMs: marks.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
    })
    if (run === 0) {
      const own = [...session.requests.values()].filter(request => request.url.startsWith(BASE))
      const sumOf = pattern => own.filter(request => pattern.test(request.url)).reduce((sum, request) => sum + request.bytes, 0)
      transfer = {
        requests: own.length,
        transferredKB: kB(own.reduce((sum, request) => sum + request.bytes, 0)),
        jsFiles: own.filter(request => /\.js(\?|$)/.test(request.url)).length,
        jsKB: kB(sumOf(/\.js(\?|$)/)),
        fontKB: kB(sumOf(/\.(ttf|woff2?)(\?|$)/)),
      }
    }
    await session.context.close()
  }
  return { ...transfer, ...medianRow(rows) }
}

async function rest(browser, state, seconds = 10) {
  const session = await open(browser, state)
  await session.go()
  await session.page.mouse.move(640, 700)
  await session.page.waitForTimeout(9000) // past every return delay of the focus overlay
  const before = await metricsOf(session.cdp)
  const events = await traced(session.cdp, () => session.page.waitForTimeout(seconds * 1000))
  const after = await metricsOf(session.cdp)
  const perSecond = count => round(count / seconds)
  const count = name => events.filter(event => event.name === name).length
  const row = {
    overlayLit: await session.page.locator('.board[data-focus-lit]').count(),
    mainThreadFramesPerS: perSecond(count('BeginMainThreadFrame')),
    layoutsPerS: perSecond(after.LayoutCount - before.LayoutCount),
    frameCallbacksPerS: perSecond(count('FireAnimationFrame')),
    mainThreadMsPerS: perSecond((after.TaskDuration - before.TaskDuration) * 1000),
  }
  await session.context.close()
  return row
}

/** One interaction on a fresh page, `RUNS` times: the median of its style work at `--throttle`x CPU. */
async function interaction(browser, state, act) {
  const rows = []
  for (let run = 0; run < RUNS; run++) {
    const session = await open(browser, state, { throttle: RATE })
    await session.go()
    await session.page.waitForTimeout(1200)
    await settled(session.page)
    const nodes = await nodeCount(session.page)
    const events = await traced(session.cdp, async () => {
      await act(session.page)
      await session.page.waitForTimeout(900)
    })
    rows.push(styleWork(events, nodes))
    await session.context.close()
  }
  return medianRow(rows)
}

const openSheet = async (page) => {
  await page.locator('#column-open-list .task-wrapper').first().click()
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible' })
}

const dragToWartet = async (page) => {
  const from = await page.locator('#column-open-list .task-wrapper').first().boundingBox()
  const target = await page.locator('#column-waiting-list').boundingBox()
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 10, y + 10, { steps: 3 })
  await page.locator('.board.dragging').waitFor({ state: 'attached' })
  await page.mouse.move(target.x + target.width / 2, target.y + 60, { steps: 40 })
  await page.mouse.move(target.x + target.width / 2, target.y + 90, { steps: 10 })
  await page.mouse.up()
  await page.locator('.board.dragging').waitFor({ state: 'detached' })
}

/** Main-thread time of the timer's one-second tick: the timer tasks of 5 s on a resting board. */
async function tick(browser, state) {
  const session = await open(browser, state, { throttle: RATE })
  await session.go()
  await session.page.waitForTimeout(1500)
  const events = await traced(session.cdp, () => session.page.waitForTimeout(5000))
  const timers = events.filter(event => event.name === 'TimerFire' && event.ph === 'X').map(event => (event.dur ?? 0) / 1000)
  await session.context.close()
  return { ticks: timers.length, msPerTick: timers.length ? round(median(timers)) : 0 }
}

// ---- run -----------------------------------------------------------------------------------------------------------

const browser = await chromium.launch()
const seed = await readDemoSeed(browser)
const result = { base: BASE, throttle: RATE, runs: RUNS }
const section = async (name, rows) => {
  if (!ONLY.has(name)) return
  result[name] = {}
  for (const [label, measure] of Object.entries(rows)) result[name][label] = await measure()
  console.log(`\n${name}`)
  console.table(result[name])
}

await section('load', {
  'demo board, 13 tasks': () => load(browser, boardState(seed)),
  'large board, 73 tasks': () => load(browser, boardState(seed, LARGE)),
})
await section('rest', {
  'no task in Jetzt': () => rest(browser, boardState(seed, { emptyJetzt: true })),
  'task in Jetzt, overlay off': () => rest(browser, boardState(seed)),
  'task in Jetzt, overlay lit (default)': () => rest(browser, boardState(seed, { focus: true })),
})
await section('sheet', { 'open a task sheet, 73 tasks': () => interaction(browser, boardState(seed, LARGE), openSheet) })
await section('drag', { 'drag Offen to Wartet, 73 tasks': () => interaction(browser, boardState(seed, LARGE), dragToWartet) })
await section('tick', {
  '13 tasks': () => tick(browser, boardState(seed)),
  '73 tasks': () => tick(browser, boardState(seed, LARGE)),
  '613 tasks': () => tick(browser, boardState(seed, { extra: 600 })),
})
await browser.close()
if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 2))
