import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import StatsRing from '~/components/statistics/StatsRing.vue'
import StatsTile from '~/components/statistics/StatsTile.vue'
import StatsTrendBars from '~/components/statistics/StatsTrendBars.vue'
import StatsTiles from '~/components/statistics/StatsTiles.vue'
import StatsVerdict from '~/components/statistics/StatsVerdict.vue'
import StatsTimeSplit from '~/components/statistics/StatsTimeSplit.vue'
import StatsWeekTable from '~/components/statistics/StatsWeekTable.vue'
import { dayKey } from '~/utils/recapDay'
import { deriveWorkRhythm } from '~/lib/workRhythm'
import { addDays, deriveReview, NO_ACTIVITY, NO_TOPIC, REVIEW, type Review } from '~/lib/statisticsReview'
import type { TaskCompletionRecord } from '~/store/taskStatistics'
import { setTestLocale } from '../../helpers/i18n'

const NOW = new Date(2026, 10, 4, 12, 0)
const TODAY = new Date(2026, 10, 4)
let seq = 0
function rec(ago: number, extra: Partial<TaskCompletionRecord> = {}): TaskCompletionRecord {
  const at = addDays(TODAY, -ago)
  at.setHours(10, 0, 0, 0)
  return {
    taskId: `t${++seq}`, title: `Task ${seq}`, completedAt: at, timeBoxSeconds: null, actualTimeSpentSeconds: 1800,
    estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false, ...extra,
  }
}
const boxed = (ago: number, accuracy: number, extra: Partial<TaskCompletionRecord> = {}) =>
  rec(ago, { timeBoxSeconds: 1800, actualTimeSpentSeconds: Math.round(18 * accuracy), estimationAccuracy: accuracy, ...extra })

/** A full history: 20 baseline tasks (half in timebox), 5 now, 4 of the afternoon pattern. */
function fullReview(): Review {
  const baseline = Array.from({ length: 20 }, (_, i) => boxed(i === 0 ? 34 : 8 + (i % 26), i % 2 ? 150 : 100, { topic: i % 2 ? 'Büro' : 'Feld', activity: 'Büro' }))
  const current = Array.from({ length: 5 }, (_, i) => boxed(i, 100, { topic: 'Büro', activity: 'Büro' }))
  return deriveReview([...baseline, ...current], NOW)
}

const THIN_RHYTHM = deriveWorkRhythm([], NOW)
/** Ten weekday sessions from 9:00 to 12:00. */
function fullRhythm() {
  const sessions = Array.from({ length: 14 }, (_, i) => ({ start: new Date(2026, 10, 3 - i, 9).getTime(), end: new Date(2026, 10, 3 - i, 12).getTime() }))
  return deriveWorkRhythm(sessions, NOW)
}

const stubs = {
  UIcon: true,
  UButton: { props: ['label'], template: '<button type="button">{{ label }}</button>' },
  UTabs: { props: ['modelValue', 'items'], template: '<div role="tablist" />' },
  TopicMark: true,
}

let mounted: VueWrapper[] = []
const mountIt = (component: object, props: Record<string, unknown>, slots: Record<string, string> = {}) => {
  const wrapper = mount(component, { props, slots, global: { stubs }, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}
const wide = (matches: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  setActivePinia(createPinia())
  wide(true)
  Element.prototype.scrollIntoView = vi.fn() // jsdom has none
})
afterEach(() => { mounted.forEach(w => w.unmount()); mounted = [] })

describe('StatsRing', () => {
  it('carries the numbers as its text alternative and hides the centre from assistive tech', () => {
    const w = mountIt(StatsRing, { segments: [{ value: 59, step: 0 }], tick: 61, label: 'In der Timebox erledigt: 59 %, sonst 61 %' }, { default: '59 %' })
    expect(w.find('svg').attributes('role')).toBe('img')
    expect(w.find('svg').attributes('aria-label')).toContain('59 %')
    expect(w.find('[aria-hidden="true"]').text()).toBe('59 %')
    expect(w.findAll('circle')).toHaveLength(2) // track + one segment
    expect(w.find('line').exists()).toBe(true) // the tick
  })

  it('draws no segment for 0 and no tick without a value', () => {
    const w = mountIt(StatsRing, { segments: [{ value: 0, step: 0 }], label: 'x' })
    expect(w.findAll('circle')).toHaveLength(1)
    expect(w.find('line').exists()).toBe(false)
  })
})

describe('StatsVerdict', () => {
  it('shows the verdict sentence, the line and the ring with its usual value', () => {
    const w = mountIt(StatsVerdict, { review: fullReview() })
    expect(w.get('[data-testid="stats-verdict-headline"]').text()).toBe('Es läuft besser als sonst.')
    expect(w.get('[data-testid="stats-verdict-line"]').text()).toBe('5 Aufgaben erledigt, 100 % davon in der Timebox (sonst 50 %).')
    expect(w.find('svg').attributes('aria-label')).toBe('In der Timebox erledigt: 100 %, sonst 50 %')
    expect(w.text()).not.toMatch(/\d \/ \d/)
  })

  it('has an English text for each branch and no German leftovers', () => {
    setTestLocale('en')
    const w = mountIt(StatsVerdict, { review: fullReview() })
    expect(w.text()).toContain('Things are going better than usual.')
    expect(w.text()).not.toMatch(/Aufgabe|erledigt|sonst/)
  })

  it('empty: a sentence, what fills the page and the ring\'s bare outline as a decorative placeholder (kd#106)', () => {
    const w = mountIt(StatsVerdict, { review: deriveReview([], NOW) })
    expect(w.get('h2').text()).toBe('Noch nichts zu vergleichen.')
    expect(w.text()).toContain('Erledigte Aufgaben mit Timebox füllen diese Seite.')
    const svg = w.get('[data-testid="stats-verdict-placeholder"] svg')
    expect(w.get('[data-testid="stats-verdict-placeholder"]').classes()).toContain('max-md:hidden')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
    // only the track: no segment, no tick, no number
    expect(svg.findAll('circle')).toHaveLength(1)
    expect(w.text()).not.toContain('%')
  })

  it('thin: says so with the baseline count, no ring (#687)', () => {
    const review = deriveReview([boxed(1, 100), boxed(2, 100)], NOW)
    const w = mountIt(StatsVerdict, { review })
    expect(w.get('h2').text()).toBe('Noch zu wenig Verlauf für einen Vergleich.')
    expect(w.text()).toContain(`In den ${REVIEW.baselineDays} Tagen vor den letzten ${REVIEW.windowDays} Tagen: 0 erledigte Aufgaben.`)
    expect(w.find('svg').exists()).toBe(false)
  })

  it('thin because of the baseline: counts the tasks of the baseline window, names the windows and the rule from REVIEW', () => {
    // 300 tasks in all, but only 2 in the 4 weeks before the last 7 days (a long break)
    const old = Array.from({ length: 298 }, (_, i) => rec(60 + (i % 200)))
    const review = deriveReview([...old, rec(0), rec(1), rec(10), rec(11)], NOW)
    expect(review.state).toBe('thin')
    const line = mountIt(StatsVerdict, { review }).get('[data-testid="stats-verdict-line"]').text()
    expect(line).toContain(`In den ${REVIEW.baselineDays} Tagen vor den letzten ${REVIEW.windowDays} Tagen: 2 erledigte Aufgaben`)
    expect(line).not.toContain('300')
    expect(line).toContain(`${REVIEW.minBaselineDays} Tagen`)
    expect(line).toContain(`${REVIEW.minBaselineTasks} erledigten Aufgaben`)
  })

  it('quiet week: the weekly average uses the locale decimal separator', () => {
    // 10 baseline tasks over 28 days = 2.5 per week
    const baseline = Array.from({ length: 10 }, (_, i) => rec(8 + i * 2))
    const review = deriveReview([...baseline, rec(34)], NOW)
    expect(review.state).toBe('quiet')
    expect(mountIt(StatsVerdict, { review }).get('[data-testid="stats-verdict-line"]').text()).toMatch(/\d,\d Aufgaben pro Woche/)
    setTestLocale('en')
    expect(mountIt(StatsVerdict, { review }).get('[data-testid="stats-verdict-line"]').text()).toMatch(/\d\.\d tasks a week|\d\.\d tasks per week/)
  })

  it('quiet week: a plain statement and the weekly average, no ring', () => {
    const baseline = Array.from({ length: 20 }, (_, i) => rec(i === 0 ? 34 : 8 + (i % 26)))
    const w = mountIt(StatsVerdict, { review: deriveReview(baseline, NOW) })
    expect(w.get('h2').text()).toBe('In den letzten 7 Tagen wurde nichts erledigt.')
    expect(w.text()).toContain('im Schnitt 5 Aufgaben pro Woche')
    expect(w.find('svg').exists()).toBe(false)
  })

  it('no timeboxed task now: track only, centre dash, no timebox clause', () => {
    const baseline = Array.from({ length: 20 }, (_, i) => boxed(i === 0 ? 34 : 8 + (i % 26), 100))
    const review = deriveReview([...baseline, rec(0), rec(1)], NOW)
    const w = mountIt(StatsVerdict, { review })
    expect(w.get('[data-testid="stats-verdict-line"]').text()).toBe('2 Aufgaben erledigt.')
    expect(w.findAll('circle')).toHaveLength(1)
    expect(w.text()).toContain('–')
  })
})

describe('StatsTrendBars', () => {
  const week = (share: number | null, i: number) => ({
    start: addDays(TODAY, -7 * (7 - i)), end: addDays(TODAY, -7 * (6 - i)), tasks: 5, boxed: 5, seconds: 3600, inTimeboxShare: share,
  })

  it('keeps the value label out of the bar track: the bar height is its share of a track of its own', () => {
    const shares = [50, 84, 90, 100, null, 20, 60, 70]
    const w = mountIt(StatsTrendBars, { weeks: shares.map(week), labelled: true })
    const bars = w.findAll('[data-testid="stats-trend-bar"]')
    expect(bars).toHaveLength(7)
    // a bar's parent is the track; the label lives beside it, not inside, so % heights are relative to one common track
    for (const bar of bars) expect(bar.element.parentElement!.children).toHaveLength(1)
    expect(bars.map(b => (b.element as HTMLElement).style.height)).toEqual(['50%', '84%', '90%', '100%', '20%', '60%', '70%'])
    const tracks = bars.map(b => b.element.parentElement!)
    expect(new Set(tracks.map(t => t.className)).size).toBe(1)
    expect(w.text()).toContain('84 %')
  })
})

describe('StatsTile', () => {
  it('is a heading holding one toggle with aria-expanded and aria-controls; the panel exists only while open', async () => {
    const w = mountIt(StatsTile, { n: 2, question: 'Wie entwickle ich mich?', line: 'Zeile', open: false }, { default: '<i class="chart" />', detail: '<a href="#x">Detail</a>' })
    const button = w.get('h2 button')
    expect(button.text()).toContain('Wie entwickle ich mich?')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(w.find('.chart').exists()).toBe(true)
    expect(w.find('a').exists()).toBe(false)
    await w.setProps({ open: true })
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(w.get(`#${button.attributes('aria-controls')}`).find('a').exists()).toBe(true)
  })

  it('emits toggle on click and on Esc only while open', async () => {
    const w = mountIt(StatsTile, { n: 3, question: 'Q', line: 'L', open: false })
    await w.get('button').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('toggle')).toBeUndefined()
    await w.get('button').trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
    await w.setProps({ open: true })
    await w.get('button').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('toggle')).toHaveLength(2)
  })

  it('without toggleable the heading is plain text with no button', () => {
    const w = mountIt(StatsTile, { n: 3, question: 'Wo schätze ich falsch?', line: 'L', open: false, toggleable: false })
    expect(w.find('button').exists()).toBe(false)
    expect(w.get('h2').text()).toContain('Wo schätze ich falsch?')
  })
})

describe('StatsTiles', () => {
  const headings = (w: VueWrapper) => w.findAll('section:not([data-testid="stats-tile-5"]) h2').map(h => h.text().replace(/^\d \/ 4/, '').trim())
  const toggle = (w: VueWrapper, n: number) => w.get(`[data-testid="stats-tile-${n}-toggle"]`)

  it('lists the three questions in natural order with one line each', () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() })
    expect(headings(w)).toEqual(['Wie entwickle ich mich?', 'Wo schätze ich falsch?', 'Wofür nehme ich mir Zeit?'])
    expect(w.findAll('[aria-expanded="true"]')).toHaveLength(0)
  })

  it('opens one tile at a time and closes it again', async () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() })
    await toggle(w, 2).trigger('click')
    expect(toggle(w, 2).attributes('aria-expanded')).toBe('true')
    await toggle(w, 4).trigger('click')
    expect(toggle(w, 2).attributes('aria-expanded')).toBe('false')
    expect(toggle(w, 4).attributes('aria-expanded')).toBe('true')
    await toggle(w, 4).trigger('click')
    expect(w.findAll('[aria-expanded="true"]')).toHaveLength(0)
  })

  it('at md+ moves the open tile first in the DOM (tile 4 before 2 and 3) and keeps focus on its toggle', async () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() })
    await toggle(w, 4).trigger('click')
    await nextTick()
    expect(headings(w)).toEqual(['Wofür nehme ich mir Zeit?', 'Wie entwickle ich mich?', 'Wo schätze ich falsch?'])
    expect(document.activeElement).toBe(toggle(w, 4).element)
    await toggle(w, 4).trigger('click')
    await nextTick()
    expect(headings(w)).toEqual(['Wie entwickle ich mich?', 'Wo schätze ich falsch?', 'Wofür nehme ich mir Zeit?'])
    expect(document.activeElement).toBe(toggle(w, 4).element)
  })

  it('below md the order stays natural', async () => {
    wide(false)
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() })
    await toggle(w, 4).trigger('click')
    expect(headings(w)).toEqual(['Wie entwickle ich mich?', 'Wo schätze ich falsch?', 'Wofür nehme ich mir Zeit?'])
    expect(toggle(w, 4).attributes('aria-expanded')).toBe('true')
  })

  it('reads the initial tile from the prop', () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview(), initialOpen: 3 })
    expect(toggle(w, 3).attributes('aria-expanded')).toBe('true')
    expect(w.findAll('[aria-expanded="true"]')).toHaveLength(1)
  })

  it('opens Q3 with the outliers and emits open-task for one', async () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview(), initialOpen: 3 })
    const outliers = w.get('[data-testid="stats-outliers"]')
    await outliers.get('button').trigger('click')
    expect(w.emitted('open-task')).toHaveLength(1)
  })

  it('without any timebox Q3 is a plain heading with the hint, and ?open=3 stays closed', () => {
    const review = deriveReview([rec(1), rec(2)], NOW)
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review, initialOpen: 3 })
    expect(w.find('[data-testid="stats-tile-3-toggle"]').exists()).toBe(false)
    expect(w.get('[data-testid="stats-tile-3"]').text()).toContain('Ohne Timebox gibt es keinen Vergleich. Setze beim nächsten Mal eine.')
    expect(w.findAll('[aria-expanded="true"]')).toHaveLength(0)
  })

  it('Q4 line does not call the largest named topic the main one when tasks without a topic take most of the time', () => {
    const records = [
      ...Array.from({ length: 8 }, (_, i) => rec(i, { actualTimeSpentSeconds: 3600 })),
      rec(9, { actualTimeSpentSeconds: 3600 * 1.4, topic: 'Büro' }),
      ...Array.from({ length: 8 }, (_, i) => rec(20 + i)),
    ]
    const review = deriveReview(records, NOW)
    expect(review.split.byTopic[0]?.key).toBe(NO_TOPIC)
    const text = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review }).get('[data-testid="stats-tile-4"]').text()
    expect(text).not.toContain('Meist in')
    expect(text).toContain('in den letzten 4 Wochen')
  })

  it('Q4 line names the top topic when it is the largest slice', () => {
    const text = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() }).get('[data-testid="stats-tile-4"]').text()
    expect(text).toContain('Meist in „')
  })

  it('shows the Q2 hint while there are too few weeks', () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: deriveReview([boxed(1, 100), boxed(2, 100)], NOW) })
    expect(w.get('[data-testid="stats-tile-2"]').text()).toContain('Noch zu wenige Wochen für eine Entwicklung.')
  })
})

describe('StatsTiles work-rhythm tile (#600)', () => {
  const toggle = (w: VueWrapper, n: number) => w.get(`[data-testid="stats-tile-${n}-toggle"]`)

  it('first run: shown without a toggle, with the explanation, the day counter and ghost bars', () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview() })
    const tile = w.get('[data-testid="stats-tile-5"]')
    expect(tile.get('h2').text()).toBe('Wann arbeite ich?')
    expect(tile.text()).toContain('Noch zu wenig Daten')
    expect(tile.get('[data-testid="stats-rhythm-days"]').text()).toBe('0 von 5 Tagen')
    expect(tile.find('[data-testid="stats-rhythm-ghost"]').exists()).toBe(true)
    expect(tile.find('button').exists()).toBe(false)
  })

  it('no tile carries a step label ("n / n"; D3 on #600)', () => {
    const w = mountIt(StatsTiles, { rhythm: fullRhythm(), review: fullReview() })
    for (const n of [2, 3, 4, 5]) expect(w.get(`[data-testid="stats-tile-${n}"] h2`).text()).not.toMatch(/\d \/ \d/)
  })

  it('is shown even when the review is empty (Q2 to Q4 are hidden then)', () => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: deriveReview([], NOW) })
    expect(w.find('[data-testid="stats-tile-2"]').exists()).toBe(false)
    expect(w.find('[data-testid="stats-tile-5"]').exists()).toBe(true)
  })

  it('normal state: one sentence with the peak window and the start, 16 bars with the peak in strong ink', () => {
    const w = mountIt(StatsTiles, { rhythm: fullRhythm(), review: fullReview() })
    const tile = w.get('[data-testid="stats-tile-5"]')
    expect(tile.text()).toContain('Meist zwischen 9 und 12 Uhr, dort liegen 100\u00a0% deiner Zeit.')
    expect(tile.text()).toMatch(/Du fängst an Werktagen meist um 0?9:00 an\./)
    expect(tile.findAll('[data-testid="stats-rhythm-bar"]')).toHaveLength(16)
    expect(tile.findAll('[data-peak="true"]')).toHaveLength(3)
    expect(tile.get('[role="img"]').attributes('aria-label')).toContain('9 und 12 Uhr')
  })

  it('opens in place, one at a time with Q2 to Q4, and stays last in the DOM', async () => {
    const w = mountIt(StatsTiles, { rhythm: fullRhythm(), review: fullReview() })
    await toggle(w, 2).trigger('click')
    await toggle(w, 5).trigger('click')
    expect(toggle(w, 2).attributes('aria-expanded')).toBe('false')
    expect(toggle(w, 5).attributes('aria-expanded')).toBe('true')
    expect(w.findAll('section').map(s => s.attributes('data-testid')).at(-1)).toBe('stats-tile-5')
    const tile = w.get('[data-testid="stats-tile-5"]')
    expect(tile.get('h3').text()).toBe('Durchschnittlich pro Stunde, letzte 8 Wochen')
    expect(tile.find('[data-testid="stats-rhythm-bars"]').exists()).toBe(false)
    expect(tile.findAll('[data-testid="stats-rhythm-cell"]')).toHaveLength(7 * 16)
    expect(tile.get('[data-testid="stats-rhythm-grid"]').attributes('aria-label')).toContain('Meiste Zeit zwischen 9 und 12 Uhr')
    expect(tile.get('[data-testid="stats-rhythm-rows"]').text()).toContain('Beginn, meist um')
    expect(tile.get('[data-testid="stats-rhythm-rows"]').text()).toContain('Ende, meist um')
    await toggle(w, 5).trigger('keydown', { key: 'Escape' })
    expect(toggle(w, 5).attributes('aria-expanded')).toBe('false')
  })

  it('reads ?open=5 and ignores it while the tile has no data', () => {
    expect(toggle(mountIt(StatsTiles, { rhythm: fullRhythm(), review: fullReview(), initialOpen: 5 }), 5).attributes('aria-expanded')).toBe('true')
    const thin = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview(), initialOpen: 5 })
    expect(thin.find('[data-testid="stats-tile-5-toggle"]').exists()).toBe(false)
  })
})

describe('time the completion records do not hold (#537)', () => {
  const toggle = (w: VueWrapper, n: number) => w.get(`[data-testid="stats-tile-${n}-toggle"]`)
  const line = async (unfinished: { openSeconds: number, discardedSeconds: number } | undefined) => {
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview(), unfinished })
    await toggle(w, 4).trigger('click')
    return w.find('[data-testid="stats-unfinished"]')
  }

  it('names both parts in the open Q4 panel', async () => {
    const el = await line({ openSeconds: 3600 * 3 + 600, discardedSeconds: 3900 })
    expect(el.text()).toBe('Nicht eingerechnet: 3 h 10 min auf offenen Aufgaben, 1 h 5 min auf gelöschten (letzte 4 Wochen).')
  })

  it('names only the part that is above 0', async () => {
    expect((await line({ openSeconds: 1800, discardedSeconds: 0 })).text()).toContain('auf offenen Aufgaben.')
    expect((await line({ openSeconds: 1800, discardedSeconds: 0 })).text()).not.toContain('gelöscht')
    expect((await line({ openSeconds: 0, discardedSeconds: 1800 })).text()).toContain('auf gelöschten Aufgaben (letzte 4 Wochen)')
  })

  it('has no line, and no empty sentence, when both are 0 or absent, and not while the tile is closed', async () => {
    expect((await line({ openSeconds: 0, discardedSeconds: 0 })).exists()).toBe(false)
    expect((await line(undefined)).exists()).toBe(false)
    const closed = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review: fullReview(), unfinished: { openSeconds: 60, discardedSeconds: 60 } })
    expect(closed.find('[data-testid="stats-unfinished"]').exists()).toBe(false)
  })

  it('is also shown when nothing was completed in the last 4 weeks', async () => {
    const review = deriveReview([rec(40), rec(41)], NOW)
    expect(review.split.taskCount).toBe(0)
    const w = mountIt(StatsTiles, { rhythm: THIN_RHYTHM, review, unfinished: { openSeconds: 1800, discardedSeconds: 0 } })
    await toggle(w, 4).trigger('click')
    expect(w.find('[data-testid="stats-unfinished"]').exists()).toBe(true)
  })

  it('has an English text for each branch', async () => {
    setTestLocale('en')
    expect((await line({ openSeconds: 3600, discardedSeconds: 1800 })).text()).toMatch(/^Not included: .+ on open tasks, .+ on deleted ones \(last 4 weeks\)\.$/)
  })
})

describe('StatsWeekTable day-end column (#537)', () => {
  const key = (ago: number) => dayKey(addDays(TODAY, -ago))
  const rows = (dayEnd: Record<string, number>) =>
    mountIt(StatsWeekTable, { weeks: deriveReview([rec(0)], NOW, dayEnd).weeks }).findAll('[data-testid="stats-week-day-end"]').map(el => el.text())

  it('shows the average per window with a locale decimal and a dash where there are fewer than 3 days', () => {
    const texts = rows({ [key(0)]: 6, [key(1)]: 3, [key(2)]: 4 })
    expect(texts[0]).toBe('im Schnitt 4,3 offen am Tagesende')
    expect(texts.slice(1).every(t => t === 'Offen am Tagesende –')).toBe(true)
  })

  it('shows a whole average without decimals and never a 0 for a missing value', () => {
    expect(rows({ [key(0)]: 4, [key(1)]: 4, [key(2)]: 4 })[0]).toBe('im Schnitt 4 offen am Tagesende')
    expect(rows({})[0]).toBe('Offen am Tagesende –')
  })

  it('reads English', () => {
    setTestLocale('en')
    expect(rows({ [key(0)]: 6, [key(1)]: 3, [key(2)]: 4 })[0]).toBe('on average 4.3 open at day end')
  })
})

describe('StatsTimeSplit labels', () => {
  const split = (records: TaskCompletionRecord[]) => deriveReview(records, NOW).split

  it('translates the no-topic / no-activity groups and never shows the raw sentinel', () => {
    const rows = (by: 'topic' | 'activity') => mountIt(StatsTimeSplit, { split: split([rec(1), rec(2)]), by, mode: 'rows' }).text()
    expect(rows('topic')).toContain('Ohne Thema')
    expect(rows('activity')).toContain('Ohne Aktivität')
    setTestLocale('en')
    expect(rows('topic')).toContain('No topic')
    expect(rows('topic')).not.toContain(NO_TOPIC)
    expect(rows('activity')).toContain('No activity')
    expect(rows('activity')).not.toContain(NO_ACTIVITY)
  })

  it('does not translate a real topic that is named like the German label', () => {
    setTestLocale('en')
    const w = mountIt(StatsTimeSplit, { split: split([rec(1, { topic: 'Ohne Thema' })]), by: 'topic', mode: 'rows' })
    expect(w.text()).toContain('Ohne Thema')
  })

  it('folds slices beyond four into "Sonstiges" and states the numbers in the ring label', () => {
    const records = ['a', 'b', 'c', 'd', 'e', 'f'].map((topic, i) => rec(1 + i, { topic, actualTimeSpentSeconds: 600 * (6 - i) }))
    const w = mountIt(StatsTimeSplit, { split: split(records), by: 'topic', mode: 'chart', legendCount: 5 })
    expect(w.text()).toContain('Sonstiges')
    expect(w.find('svg').attributes('aria-label')).toMatch(/^Zeit nach Thema, letzte 4 Wochen: a \d+ %/)
  })
})
