import { describe, it, expect } from 'vitest'
import type { TaskCompletionRecord } from '~/store/taskStatistics'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { dayKey } from '~/utils/recapDay'
import { addDays, deriveReview, deriveUnfinishedTime, foldSlices, median, NO_ACTIVITY, NO_TOPIC, OTHER_SLICE, REVIEW } from '~/lib/statisticsReview'

// Wednesday 2026-11-04, noon. Current window = Oct 29 .. Nov 4, baseline = Oct 1 .. Oct 28.
const NOW = new Date(2026, 10, 4, 12, 0)
const TODAY = new Date(2026, 10, 4)

let seq = 0
/** A completion record `ago` calendar days before today at `hour`. Defaults: not timeboxed, planned. */
function rec(ago: number, extra: Partial<TaskCompletionRecord> = {}, hour = 10): TaskCompletionRecord {
  const at = addDays(TODAY, -ago)
  at.setHours(hour, 0, 0, 0)
  return {
    taskId: `t${++seq}`, title: `Task ${seq}`, completedAt: at, timeBoxSeconds: null, actualTimeSpentSeconds: 1800,
    estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false, ...extra,
  }
}
/** A timeboxed record with the given accuracy (percent of a 30 min timebox). */
const boxed = (ago: number, accuracy: number, extra: Partial<TaskCompletionRecord> = {}, hour = 10) =>
  rec(ago, { timeBoxSeconds: 1800, actualTimeSpentSeconds: Math.round(18 * accuracy), estimationAccuracy: accuracy, ...extra }, hour)
const many = (n: number, make: (i: number) => TaskCompletionRecord) => Array.from({ length: n }, (_, i) => make(i))

/** 28 days of baseline: `n` plain tasks spread over days 7..34 ago, the earliest 34 days ago (full baseline). */
const baselineOf = (n: number, make: (ago: number, i: number) => TaskCompletionRecord = ago => rec(ago)) =>
  many(n, i => make(i === 0 ? 34 : 8 + (i % 26), i))

describe('deriveReview windows and states', () => {
  it('is empty without records and skips unusable ones', () => {
    expect(deriveReview([], NOW).state).toBe('empty')
    const broken = [{ ...rec(1), completedAt: new Date('nope') }, { ...rec(1), actualTimeSpentSeconds: Number.NaN }]
    const review = deriveReview(broken, NOW)
    expect(review.state).toBe('empty')
    expect(review.recordCount).toBe(0)
  })

  it('revives completedAt strings from storage', () => {
    const stored = { ...rec(0), completedAt: addDays(TODAY, 0).toISOString() as unknown as Date }
    expect(deriveReview([stored], NOW).current.count).toBe(1)
  })

  it('is thin when the history is younger than 14 baseline days', () => {
    // earliest record 19 days ago: 19 - 6 = 13 baseline days
    const review = deriveReview([...many(10, () => rec(19)), rec(0)], NOW)
    expect(review.baseline.days).toBe(13)
    expect(review.state).toBe('thin')
    expect(review.verdict).toBeNull()
  })

  it('has a verdict from 14 baseline days on (and 8 baseline tasks)', () => {
    const review = deriveReview([...many(8, () => rec(20)), rec(0)], NOW)
    expect(review.baseline.days).toBe(14)
    expect(review.state).toBe('verdict')
  })

  it('is thin with fewer than 8 baseline tasks even for a long history', () => {
    const review = deriveReview([...many(7, () => rec(20)), rec(0)], NOW)
    expect(review.baseline.days).toBe(14)
    expect(review.state).toBe('thin')
  })

  it('caps the baseline at 28 days and divides the norm by baselineDays / 7', () => {
    const full = deriveReview([...baselineOf(20), rec(0)], NOW)
    expect(full.baseline.days).toBe(28)
    expect(full.baseline.weeklyNorm).toBe(5)
    // a 14 day baseline with 10 tasks is a norm of 5 a week, not 2.5
    const young = deriveReview([...many(10, () => rec(20)), rec(0)], NOW)
    expect(young.baseline.weeklyNorm).toBe(5)
  })

  it('is quiet when the baseline is valid and nothing was done in the current window', () => {
    const review = deriveReview(baselineOf(20), NOW)
    expect(review.state).toBe('quiet')
    expect(review.verdict).toBeNull()
    expect(review.current.count).toBe(0)
  })

  it('uses local calendar days across a DST change (windows start at local midnight)', () => {
    const dst = new Date(2026, 2, 30, 12, 0) // the day after the EU spring-forward
    const review = deriveReview([], dst)
    review.weeks.forEach(w => {
      expect(w.start.getHours()).toBe(0)
      expect(w.end.getHours()).toBe(0)
    })
    expect(review.weeks).toHaveLength(REVIEW.weeks)
  })

  it('counts today and the 6 days before as current, and the day 7 ago as baseline', () => {
    const review = deriveReview([rec(0), rec(6), rec(7)], NOW)
    expect(review.current.count).toBe(2)
    expect(review.baseline.count).toBe(1)
  })
})

describe('deriveReview signals and verdict', () => {
  const withCurrent = (n: number, extra: Partial<TaskCompletionRecord> = {}) => many(n, i => rec(i % 7, extra))

  it('output: +20 % / -20 % of the weekly norm count, 19 % does not', () => {
    const base = baselineOf(20) // norm 5 a week
    expect(deriveReview([...base, ...withCurrent(6)], NOW).signals.output).toBe(1) // exactly +20 %
    expect(deriveReview([...base, ...withCurrent(5)], NOW).signals.output).toBe(0)
    expect(deriveReview([...base, ...withCurrent(4)], NOW).signals.output).toBe(-1) // exactly -20 %
    const base100 = baselineOf(100) // norm 25
    expect(deriveReview([...base100, ...withCurrent(30)], NOW).signals.output).toBe(1)
    expect(deriveReview([...base100, ...withCurrent(29)], NOW).signals.output).toBe(0) // +16 %
    expect(deriveReview([...base100, ...withCurrent(21)], NOW).signals.output).toBe(0) // -16 %
  })

  it('in timebox: +/-10 points at the boundary, needs 4 current and 8 baseline timeboxed tasks', () => {
    const base = baselineOf(20, (ago, i) => boxed(ago, i % 2 ? 150 : 100)) // 50 % in timebox
    const cur = (inT: number, total: number) => many(total, i => boxed(i % 7, i < inT ? 100 : 150))
    expect(deriveReview([...base, ...cur(3, 5)], NOW).signals.inTimebox).toBe(1) // 60 %: +10 points
    expect(deriveReview([...base, ...cur(2, 4)], NOW).signals.inTimebox).toBe(0) // 50 %
    expect(deriveReview([...base, ...cur(2, 5)], NOW).signals.inTimebox).toBe(-1) // 40 %: -10 points
    expect(deriveReview([...base, ...cur(4, 5)], NOW).signals.inTimebox).toBe(1)
    // 3 current timeboxed tasks: too few to claim anything
    expect(deriveReview([...base, ...cur(3, 3)], NOW).signals.inTimebox).toBe(0)
    // 7 baseline timeboxed tasks: too few
    const thinBase = [...baselineOf(13), ...many(7, i => boxed(8 + i, i % 2 ? 150 : 100))]
    expect(deriveReview([...thinBase, ...cur(5, 5)], NOW).signals.inTimebox).toBe(0)
  })

  it('unplanned: a rise of 15 points is -1, a drop of 15 points is +1 (symmetric), needs 4 / 8 tasks', () => {
    const base = baselineOf(20, (ago, i) => rec(ago, { isUnplanned: i < 2 })) // 10 %
    const cur = (unplanned: number, total: number) => many(total, i => rec(i % 7, { isUnplanned: i < unplanned }))
    expect(deriveReview([...base, ...cur(5, 20)], NOW).signals.unplanned).toBe(-1) // 25 %: +15 points
    expect(deriveReview([...base, ...cur(4, 20)], NOW).signals.unplanned).toBe(0) // 20 %
    const busyBase = baselineOf(20, (ago, i) => rec(ago, { isUnplanned: i < 8 })) // 40 %
    expect(deriveReview([...busyBase, ...cur(5, 20)], NOW).signals.unplanned).toBe(1) // 25 %: -15 points
    expect(deriveReview([...busyBase, ...cur(6, 20)], NOW).signals.unplanned).toBe(0) // 30 %
    // 3 current tasks: below the sample minimum
    expect(deriveReview([...base, ...cur(3, 3)], NOW).signals.unplanned).toBe(0)
  })

  it('maps the score to the verdict: better, harder, usual', () => {
    const base = baselineOf(20)
    expect(deriveReview([...base, ...many(6, i => rec(i))], NOW).verdict).toBe('better')
    expect(deriveReview([...base, ...many(4, i => rec(i))], NOW).verdict).toBe('harder')
    expect(deriveReview([...base, ...many(5, i => rec(i))], NOW).verdict).toBe('usual')
  })

  it('cancels opposed signals to "usual"', () => {
    // output +1 (6 vs 5 a week) and unplanned -1 (all 6 unplanned vs. none): score 0
    const review = deriveReview([...baselineOf(20), ...many(6, i => rec(i, { isUnplanned: true }))], NOW)
    // 6 current tasks are below minCurrent? no: 6 >= 4, baseline 20 >= 8
    expect(review.signals).toMatchObject({ output: 1, unplanned: -1 })
    expect(review.verdict).toBe('usual')
  })

  it('a single signal decides', () => {
    const review = deriveReview([...baselineOf(20), ...many(4, i => rec(i))], NOW)
    expect(review.signals).toEqual({ output: -1, inTimebox: 0, unplanned: 0 })
    expect(review.verdict).toBe('harder')
  })
})

describe('deriveReview weekly series and trend', () => {
  it('returns 8 windows, oldest first, the newest is the current window', () => {
    const review = deriveReview([rec(0), rec(7), rec(55)], NOW)
    expect(review.weeks).toHaveLength(8)
    expect(review.weeks[7]!.end.getTime()).toBe(addDays(TODAY, 1).getTime())
    expect(review.weeks[7]!.tasks).toBe(1)
    expect(review.weeks[6]!.tasks).toBe(1)
    expect(review.weeks[0]!.tasks).toBe(1) // 55 days ago is the first day of the oldest window
    expect(review.weeks[0]!.start.getTime()).toBe(addDays(TODAY, -55).getTime())
  })

  it('gives a window a value from two timeboxed tasks', () => {
    const review = deriveReview([boxed(0, 100), boxed(1, 150), boxed(8, 100)], NOW)
    expect(review.weeks[7]!.inTimeboxShare).toBe(50)
    expect(review.weeks[6]!.inTimeboxShare).toBeNull()
  })

  /** Two timeboxed tasks in the week `ago` days back: `inTimebox` of them (0, 1, 2) within the timebox = 0 / 50 / 100 %. */
  const week = (ago: number, inTimebox: 0 | 1 | 2) => [boxed(ago, inTimebox >= 1 ? 100 : 150), boxed(ago, inTimebox === 2 ? 100 : 150)]
  /** Series oldest first, one window per entry; the newest ends in the current window. */
  const series = (values: Array<0 | 1 | 2>) => values.flatMap((v, i) => week((values.length - 1 - i) * 7 + 1, v))

  it('detects up, down, flat and too few weeks', () => {
    expect(deriveReview(series([0, 0, 1, 2, 2]), NOW).trend.direction).toBe('up')
    expect(deriveReview(series([2, 2, 1, 0, 0]), NOW).trend.direction).toBe('down')
    expect(deriveReview(series([1, 1, 1, 1]), NOW).trend.direction).toBe('flat')
    expect(deriveReview(series([0, 2, 2]), NOW).trend.direction).toBe('few')
  })

  it('compares the mean of the 2 oldest with the 2 newest windows that have a value', () => {
    const review = deriveReview(series([0, 1, 1, 2, 2]), NOW)
    expect(review.trend).toMatchObject({ direction: 'up', early: 25, recent: 100 })
  })
})

describe('deriveReview patterns', () => {
  const group = (n: number, accuracy: number, extra: Partial<TaskCompletionRecord>) => many(n, i => boxed(1 + i, accuracy, extra))

  it('claims a group from 4 tasks and 15 points off, not below', () => {
    expect(deriveReview(group(3, 140, { activity: 'Büro' }), NOW).patterns).toEqual([])
    expect(deriveReview(group(4, 114, { activity: 'Büro' }), NOW).patterns.filter(p => p.kind === 'activity')).toEqual([])
    const claimed = deriveReview(group(4, 115, { activity: 'Büro' }), NOW).patterns.find(p => p.kind === 'activity')!
    expect(claimed).toMatchObject({ key: 'Büro', n: 4, median: 115, deviation: 15 })
    const shorter = deriveReview(group(4, 70, { topic: 'Fuhrpark' }), NOW).patterns.find(p => p.kind === 'topic')!
    expect(shorter.deviation).toBe(-30)
  })

  it('never makes a group of "no activity" or "no topic"', () => {
    const kinds = deriveReview(group(6, 150, {}), NOW).patterns.map(p => p.kind)
    expect(kinds).not.toContain('activity')
    expect(kinds).not.toContain('topic')
  })

  it('groups by timebox size and completion half-day with their edges', () => {
    const sized = (minutes: number) => many(4, i => rec(1 + i, { timeBoxSeconds: minutes * 60, actualTimeSpentSeconds: minutes * 90, estimationAccuracy: 150 }))
    const keys = (minutes: number) => deriveReview(sized(minutes), NOW).patterns.filter(p => p.kind === 'size').map(p => p.key)
    expect(keys(30)).toEqual(['s'])
    expect(keys(31)).toEqual(['m'])
    expect(keys(60)).toEqual(['m'])
    expect(keys(61)).toEqual(['l'])
    expect(keys(90)).toEqual(['l'])
    expect(keys(91)).toEqual(['xl'])
    const at = (hour: number) => many(4, i => boxed(1 + i, 150, {}, hour))
    expect(deriveReview(at(11), NOW).patterns.find(p => p.kind === 'time')!.key).toBe('am')
    expect(deriveReview(at(12), NOW).patterns.find(p => p.kind === 'time')!.key).toBe('pm')
  })

  it('looks at the last 56 days only', () => {
    expect(deriveReview(group(4, 150, { activity: 'Büro' }).map(r => ({ ...r, completedAt: addDays(r.completedAt, -60) })), NOW).patterns).toEqual([])
  })

  it('ranks by deviation times the square root of the sample', () => {
    const records = [...group(4, 200, { activity: 'Büro' }), ...group(16, 150, { activity: 'Vor Ort' })]
    // Büro: 100 * 2 = 200, Vor Ort: 50 * 4 = 200 (tie broken by id); a third group outweighs both
    const ranked = deriveReview([...records, ...group(9, 190, { activity: 'Fahrt' })], NOW).patterns.filter(p => p.kind === 'activity')
    expect(ranked.map(p => p.key)).toEqual(['Fahrt', 'Büro', 'Vor Ort'])
  })

  it('computes the estimate shares from timeboxed tasks of the last 56 days', () => {
    const records = [boxed(1, 120), boxed(2, 111), boxed(3, 100), boxed(4, 90), boxed(5, 89), rec(6)]
    const { estimate } = deriveReview(records, NOW)
    expect(estimate.n).toBe(5)
    expect(estimate.longer).toBe(40) // 120, 111
    expect(estimate.shorter).toBe(20) // 89
    expect(estimate.onTarget).toBe(40) // 100, 90
  })
})

describe('deriveReview outliers and time split', () => {
  it('returns the 5 biggest overruns of the last 28 days, only tasks that ran over', () => {
    const records = [
      ...many(7, i => boxed(1 + i, 110 + i * 10)), // overruns grow with i
      boxed(2, 60), // under: never an outlier
      boxed(40, 400), // too old
      rec(3, { actualTimeSpentSeconds: 99_999 }), // no timebox
    ]
    const { outliers } = deriveReview(records, NOW)
    expect(outliers).toHaveLength(5)
    expect(outliers.map(o => o.record.estimationAccuracy)).toEqual([170, 160, 150, 140, 130])
    expect(outliers[0]!.overSeconds).toBeGreaterThan(outliers[1]!.overSeconds)
  })

  it('splits the last 28 days by topic and activity with sentinels and shares', () => {
    const records = [
      rec(1, { topic: 'A', activity: 'Büro', actualTimeSpentSeconds: 3000, isUnplanned: true }),
      rec(2, { topic: 'B', actualTimeSpentSeconds: 1200 }),
      rec(3, { actualTimeSpentSeconds: 800 }),
      rec(40, { topic: 'A', actualTimeSpentSeconds: 9999 }), // outside the window
    ]
    const { split } = deriveReview(records, NOW)
    expect(split.taskCount).toBe(3)
    expect(split.seconds).toBe(5000)
    expect(split.unplannedShare).toBeCloseTo(33.33, 1)
    expect(split.byTopic.map(s => [s.key, s.share])).toEqual([['A', 60], ['B', 24], [NO_TOPIC, 16]])
    expect(split.byActivity.map(s => [s.key, s.share])).toEqual([['Büro', 60], [NO_ACTIVITY, 40]])
  })

  it('folds slices beyond four into one rest slice', () => {
    const slices = ['a', 'b', 'c', 'd', 'e', 'f'].map((key, i) => ({ key, seconds: 600 - i * 100, count: 1, share: 10 }))
    const folded = foldSlices(slices)
    expect(folded.map(s => s.key)).toEqual(['a', 'b', 'c', 'd', OTHER_SLICE])
    expect(folded[4]).toMatchObject({ seconds: 300, count: 2, share: 20 })
    expect(foldSlices(slices.slice(0, 4))).toHaveLength(4)
  })

  it('reports hasTimeboxes', () => {
    expect(deriveReview([rec(1)], NOW).hasTimeboxes).toBe(false)
    expect(deriveReview([boxed(1, 100)], NOW).hasTimeboxes).toBe(true)
  })
})

describe('day-end open tasks per week (#537)', () => {
  const key = (ago: number) => dayKey(addDays(TODAY, -ago))

  it('averages the days of a window that have a value, from 3 days on', () => {
    const review = deriveReview([rec(0)], NOW, { [key(0)]: 6, [key(1)]: 3, [key(2)]: 4 })
    const current = review.weeks.at(-1)!
    expect(current.dayEndDays).toBe(3)
    expect(current.dayEndOpen).toBeCloseTo(4.3, 5)
  })

  it('is null (not 0) below 3 days, and for a window without any value', () => {
    const review = deriveReview([rec(0)], NOW, { [key(0)]: 6, [key(1)]: 3 })
    expect(review.weeks.at(-1)).toMatchObject({ dayEndDays: 2, dayEndOpen: null })
    expect(review.weeks.at(-2)).toMatchObject({ dayEndDays: 0, dayEndOpen: null })
  })

  it('puts a day into the window it belongs to, edges included', () => {
    const dayEnd = { [key(6)]: 2, [key(7)]: 8, [key(8)]: 8, [key(9)]: 8 }
    const review = deriveReview([rec(0)], NOW, dayEnd)
    expect(review.weeks.at(-1)!.dayEndDays).toBe(1) // 6 days ago is the oldest day of the current window
    expect(review.weeks.at(-2)!.dayEndDays).toBe(3)
    expect(review.weeks.at(-2)!.dayEndOpen).toBe(8)
  })

  it('skips malformed entries and leaves the rest of the review unchanged without a day-end map', () => {
    const dayEnd = { [key(0)]: 1, [key(1)]: 1, [key(2)]: 1, nonsense: 9, [key(3)]: -4, [key(4)]: Number.NaN, [key(5)]: '7' as unknown as number }
    expect(deriveReview([rec(0)], NOW, dayEnd).weeks.at(-1)).toMatchObject({ dayEndDays: 3, dayEndOpen: 1 })
    const records = [rec(0), boxed(1, 120)]
    const plain = deriveReview(records, NOW)
    const withMap = deriveReview(records, NOW, { [key(0)]: 5, [key(1)]: 5, [key(2)]: 5 })
    const { weeks: a, ...restA } = plain
    const { weeks: b, ...restB } = withMap
    expect(restB).toEqual(restA)
    expect(plain.weeks.every(w => w.dayEndOpen === null)).toBe(true)
    expect(b.map(w => w.tasks)).toEqual(a.map(w => w.tasks))
  })
})

describe('deriveUnfinishedTime (#537)', () => {
  const task = (id: string, status: TaskStatus, timeSpentSeconds: number): Task => ({
    id, source: 'local', externalId: null, title: id, notes: null, status, priority: 1, timeBoxSeconds: null, timeSpentSeconds,
    topic: null, topicColorCode: null, activity: null, timerId: null,
  } as Task)
  const at = (ago: number) => addDays(TODAY, -ago).getTime() + 3_600_000

  it('sums open, running and waiting tasks, never Done, archived or demo tasks', () => {
    const tasks = [
      task('a', TaskStatus.Open, 600), task('b', TaskStatus.Progress, 300), task('c', TaskStatus.Waiting, 60),
      task('d', TaskStatus.Done, 9000), task('e', TaskStatus.Open, 500), task('demo-x', TaskStatus.Open, 7000),
    ]
    expect(deriveUnfinishedTime(tasks, ['e'], [], NOW).openSeconds).toBe(960)
  })

  it('counts discarded time of the last 28 days only, inclusive of the oldest day', () => {
    const discarded = [
      { taskId: 'in', deletedAt: at(27), seconds: 100 },
      { taskId: 'out', deletedAt: at(28), seconds: 1000 },
      { taskId: 'zero', deletedAt: at(1), seconds: 0 },
      { taskId: 'bad', deletedAt: 'x' as unknown as number, seconds: 5 },
    ]
    expect(deriveUnfinishedTime([], [], discarded, NOW).discardedSeconds).toBe(100)
  })
})

describe('median', () => {
  it('handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('demo history (dev seed)', () => {
  it('is deterministic and gives the demo a verdict, trend, patterns and outliers', async () => {
    const { buildDemoStatisticsHistory } = await import('~/lib/demo-statistics-history')
    const a = buildDemoStatisticsHistory(NOW)
    const b = buildDemoStatisticsHistory(NOW)
    expect(a.map(r => r.taskId)).toEqual(b.map(r => r.taskId))
    expect(a.every(r => r.taskId.startsWith('demo-'))).toBe(true)
    const review = deriveReview(a, NOW)
    expect(review.state).toBe('verdict')
    expect(review.trend.direction).not.toBe('few')
    expect(review.patterns.length).toBeGreaterThan(0)
    expect(review.outliers.length).toBeGreaterThan(0)
  })
})
