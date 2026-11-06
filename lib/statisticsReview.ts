/**
 * @module lib/statisticsReview
 * @description Pure derivations behind the Statistik page (#469): the verdict of the last 7 days against the
 * 4 weeks before, the eight weekly points, the estimate patterns, the biggest overruns and where the time went.
 * Everything derives from the existing completion records; nothing is stored. The rule and every threshold are
 * the Specify decisions recorded on #469 ("Decisions"); change a number here and in its unit test, nowhere else.
 *
 * Windows are local calendar days, never millisecond arithmetic (a DST change would shift a window by an hour):
 * - current  = today and the 6 days before
 * - baseline = the 28 days before that
 * - week w   = 7 calendar days, w = 0 is the current window, w = 7 the oldest
 */
import type { DiscardedTimeRecord, TaskCompletionRecord } from '~/store/taskStatistics'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { isDemoTaskId } from '~/lib/demoIds'
import { dayKey, isValidDayKey } from '~/utils/recapDay'
import { IN_TIMEBOX_MAX_ACCURACY } from '~/utils/statisticsAccuracy'

/** Group key for records without a topic; translated at display time (`statistics.noTopic`). */
export const NO_TOPIC = '__none__'
/** Group key for records without an activity; translated at display time (`statistics.noActivity`). */
export const NO_ACTIVITY = '__none__'
/** Key of the folded rest of a time split ("Sonstiges"). */
export const OTHER_SLICE = '__other__'

/** Thresholds of the review. One place, named, tested at their boundaries. */
export const REVIEW = {
  /** Length of the current window and of one weekly point, in calendar days. */
  windowDays: 7,
  /** Length of the baseline the current window is compared with. */
  baselineDays: 28,
  /** Number of weekly points on the series. */
  weeks: 8,
  /** Output (tasks per week) deviates from the weekly norm by at least this share to count. */
  outputShift: 0.2,
  /** In-timebox share moves by at least this many points to count. */
  inTimeboxShift: 10,
  /** Unplanned share moves by at least this many points to count. */
  unplannedShift: 15,
  /** Minimum timeboxed / all tasks in the current window for the share signals. */
  minCurrent: 4,
  /** Minimum timeboxed / all tasks in the baseline for the share signals. */
  minBaseline: 8,
  /** A verdict needs this many days of baseline history ... */
  minBaselineDays: 14,
  /** ... and this many completed tasks in the baseline. */
  minBaselineTasks: 8,
  /** A weekly point has a value from this many timeboxed tasks. */
  minWeekBoxed: 2,
  /** A weekly day-end average needs values from this many days of its window (#537). */
  minDayEndDays: 3,
  /** The trend sentence needs this many weekly points with a value. */
  minTrendWeeks: 4,
  /** Trend: mean of the two oldest vs. the two newest points differs by at least this many points. */
  trendShift: 8,
  /** Patterns: window in days, tasks per group and distance of the median accuracy from 100 %. */
  patternDays: 56,
  patternMinTasks: 4,
  patternMinDeviation: 15,
  /** Closed patterns shown before "all n". */
  patternsShown: 4,
  /** Outliers: window in days and count. */
  outlierDays: 28,
  outliersShown: 5,
  /** Time split: window in days, slices kept before the rest folds into "Sonstiges". */
  splitDays: 28,
  sliceKeep: 4,
  /** Estimate ring: shorter than this share of the timebox counts as "shorter". */
  shorterBelow: 90,
} as const

export type Verdict = 'better' | 'usual' | 'harder'
/** `empty`: no completed task; `thin`: too little history for a verdict; `quiet`: a valid baseline but nothing done in the current window. */
export type ReviewState = 'empty' | 'thin' | 'quiet' | 'verdict'
export type Signal = -1 | 0 | 1

export interface WindowFigures {
  count: number
  boxed: number
  /** Share (0-100) of timeboxed tasks done within the timebox; null without timeboxed tasks. */
  inTimeboxShare: number | null
  /** Share (0-100) of tasks that were unplanned; null without tasks. */
  unplannedShare: number | null
  seconds: number
}

export interface WeekPoint {
  start: Date
  end: Date
  tasks: number
  boxed: number
  /** In-timebox share (0-100), null below {@link REVIEW.minWeekBoxed} timeboxed tasks. */
  inTimeboxShare: number | null
  seconds: number
  /** Mean tasks still in flight at day end over the days of this window that have a value (one decimal); null below {@link REVIEW.minDayEndDays} days (#537). */
  dayEndOpen: number | null
  /** Days of this window with a day-end value. */
  dayEndDays: number
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'few'
export type PatternKind = 'activity' | 'topic' | 'size' | 'time'
export type SizeBucket = 's' | 'm' | 'l' | 'xl'
export type TimeBucket = 'am' | 'pm'

export interface EstimatePattern {
  id: string
  kind: PatternKind
  /** Activity or topic name, a {@link SizeBucket} or a {@link TimeBucket}. */
  key: string
  n: number
  /** Median of `estimationAccuracy` (100 = as planned). */
  median: number
  /** `median - 100`: positive = runs longer than planned. */
  deviation: number
}

export interface Outlier {
  record: TaskCompletionRecord
  overSeconds: number
}

export interface Slice {
  key: string
  seconds: number
  count: number
  /** Share (0-100) of the window's time. */
  share: number
}

export interface Review {
  state: ReviewState
  verdict: Verdict | null
  signals: { output: Signal; inTimebox: Signal; unplanned: Signal }
  recordCount: number
  /** Whether any record has a timebox (otherwise Q3 cannot be answered). */
  hasTimeboxes: boolean
  current: WindowFigures
  baseline: WindowFigures & { days: number; weeklyNorm: number | null }
  weeks: WeekPoint[]
  trend: { direction: TrendDirection; early: number | null; recent: number | null }
  patterns: EstimatePattern[]
  estimate: { n: number; longer: number; onTarget: number; shorter: number }
  outliers: Outlier[]
  split: {
    taskCount: number
    seconds: number
    unplannedShare: number | null
    byTopic: Slice[]
    byActivity: Slice[]
  }
}

const EPS = 1e-9

/** A calendar day offset from `date`'s day, at local midnight (DST-safe). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export const startOfDay = (date: Date): Date => addDays(date, 0)

/** Whole calendar days from `a` to `b` (both local days). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000)
}

interface Entry {
  record: TaskCompletionRecord
  at: Date
}

const isBoxed = (r: TaskCompletionRecord): boolean =>
  !!r.timeBoxSeconds && r.timeBoxSeconds > 0 && typeof r.estimationAccuracy === 'number' && Number.isFinite(r.estimationAccuracy)

/** Whether a stored record is usable at all; a record missing fields is skipped. */
function toEntry(record: TaskCompletionRecord): Entry | null {
  const at = new Date(record.completedAt)
  if (Number.isNaN(at.getTime())) return null
  if (typeof record.actualTimeSpentSeconds !== 'number' || !Number.isFinite(record.actualTimeSpentSeconds)) return null
  return { record, at }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function figures(entries: Entry[]): WindowFigures {
  const boxed = entries.filter(e => isBoxed(e.record))
  const inTimebox = boxed.filter(e => e.record.estimationAccuracy! <= IN_TIMEBOX_MAX_ACCURACY).length
  return {
    count: entries.length,
    boxed: boxed.length,
    inTimeboxShare: boxed.length ? (inTimebox / boxed.length) * 100 : null,
    unplannedShare: entries.length ? (entries.filter(e => e.record.isUnplanned).length / entries.length) * 100 : null,
    seconds: entries.reduce((sum, e) => sum + e.record.actualTimeSpentSeconds, 0),
  }
}

const within = (entries: Entry[], from: Date, to: Date): Entry[] =>
  entries.filter(e => e.at >= from && e.at < to)

function slicesOf(entries: Entry[], keyOf: (r: TaskCompletionRecord) => string): Slice[] {
  const total = entries.reduce((sum, e) => sum + e.record.actualTimeSpentSeconds, 0)
  const groups = new Map<string, { seconds: number; count: number }>()
  for (const { record } of entries) {
    const key = keyOf(record)
    const group = groups.get(key) ?? { seconds: 0, count: 0 }
    group.seconds += record.actualTimeSpentSeconds
    group.count += 1
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, seconds: g.seconds, count: g.count, share: total > 0 ? (g.seconds / total) * 100 : 0 }))
    .sort((a, b) => b.seconds - a.seconds || b.count - a.count || a.key.localeCompare(b.key))
}

/** The first `keep` slices, the rest folded into one {@link OTHER_SLICE} (only when more than `keep` exist). */
export function foldSlices(slices: Slice[], keep: number = REVIEW.sliceKeep): Slice[] {
  if (slices.length <= keep) return slices
  const rest = slices.slice(keep)
  return [
    ...slices.slice(0, keep),
    {
      key: OTHER_SLICE,
      seconds: rest.reduce((s, x) => s + x.seconds, 0),
      count: rest.reduce((s, x) => s + x.count, 0),
      share: rest.reduce((s, x) => s + x.share, 0),
    },
  ]
}

const sizeBucket = (seconds: number): SizeBucket => {
  const minutes = seconds / 60
  return minutes <= 30 ? 's' : minutes <= 60 ? 'm' : minutes <= 90 ? 'l' : 'xl'
}

function patternsOf(entries: Entry[]): EstimatePattern[] {
  const boxed = entries.filter(e => isBoxed(e.record))
  const out: EstimatePattern[] = []
  const collect = (kind: PatternKind, keyOf: (e: Entry) => string | null) => {
    const groups = new Map<string, number[]>()
    for (const e of boxed) {
      const key = keyOf(e)
      if (!key) continue
      groups.set(key, [...(groups.get(key) ?? []), e.record.estimationAccuracy!])
    }
    groups.forEach((values, key) => {
      if (values.length < REVIEW.patternMinTasks) return
      const med = median(values)!
      const deviation = med - 100
      if (Math.abs(deviation) + EPS < REVIEW.patternMinDeviation) return
      out.push({ id: `${kind}:${key}`, kind, key, n: values.length, median: med, deviation })
    })
  }
  collect('activity', e => e.record.activity || null)
  collect('topic', e => e.record.topic || null)
  collect('size', e => sizeBucket(e.record.timeBoxSeconds!))
  collect('time', e => (e.at.getHours() < 12 ? 'am' : 'pm'))
  return out.sort((a, b) => Math.abs(b.deviation) * Math.sqrt(b.n) - Math.abs(a.deviation) * Math.sqrt(a.n) || a.id.localeCompare(b.id))
}

const meanOf = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length

function trendOf(weeks: WeekPoint[]): Review['trend'] {
  const withValue = weeks.filter(w => w.inTimeboxShare !== null).map(w => w.inTimeboxShare!) // oldest first
  if (withValue.length < REVIEW.minTrendWeeks) return { direction: 'few', early: null, recent: null }
  const early = meanOf(withValue.slice(0, 2))
  const recent = meanOf(withValue.slice(-2))
  const diff = recent - early
  const direction: TrendDirection = diff + EPS >= REVIEW.trendShift ? 'up' : -diff + EPS >= REVIEW.trendShift ? 'down' : 'flat'
  return { direction, early, recent }
}

/** The usable day-end values of the local days `from` (inclusive) to `to` (exclusive). */
function dayEndValuesIn(dayEnd: Record<string, number>, from: Date, to: Date): number[] {
  const fromKey = dayKey(from)
  const toKey = dayKey(to)
  return Object.entries(dayEnd)
    .filter(([key, value]) => isValidDayKey(key) && key >= fromKey && key < toKey && typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .map(([, value]) => value)
}

export interface UnfinishedTime {
  /** Tracked time on tasks still in Offen, Jetzt or Wartet (their whole lifetime, not window-bound). */
  openSeconds: number
  /** Tracked time on tasks deleted before completion within the last {@link REVIEW.splitDays} days. */
  discardedSeconds: number
}

/**
 * The time the completion records do not hold (#537): tasks still open and tasks deleted before completion.
 * @param tasks the board's tasks (any status; Done, archived and demo tasks are not counted)
 * @param discarded the stored discarded-time records; malformed entries are skipped
 */
export function deriveUnfinishedTime(
  tasks: Task[],
  archivedTaskIds: string[],
  discarded: DiscardedTimeRecord[],
  now: Date = new Date(),
): UnfinishedTime {
  const archived = new Set(archivedTaskIds)
  const openSeconds = tasks
    .filter(t => t.status !== TaskStatus.Done && !archived.has(t.id) && !isDemoTaskId(t.id))
    .reduce((sum, t) => sum + (Number.isFinite(t.timeSpentSeconds) && t.timeSpentSeconds > 0 ? t.timeSpentSeconds : 0), 0)
  const from = addDays(startOfDay(now), -(REVIEW.splitDays - 1)).getTime()
  const discardedSeconds = discarded
    .filter(r => typeof r.deletedAt === 'number' && r.deletedAt >= from && typeof r.seconds === 'number' && Number.isFinite(r.seconds) && r.seconds > 0)
    .reduce((sum, r) => sum + r.seconds, 0)
  return { openSeconds, discardedSeconds }
}

/**
 * Derives the whole review from the completion records.
 * @param records all completion records (any order; `completedAt` may still be an ISO string)
 * @param now the moment "today" is read from
 * @param dayEnd tasks in flight by local day (`YYYY-MM-DD`), the weekly day-end average of the Q2 table (#537); malformed entries are skipped
 */
export function deriveReview(
  records: TaskCompletionRecord[],
  now: Date = new Date(),
  dayEnd: Record<string, number> = {},
): Review {
  const entries = records.map(toEntry).filter((e): e is Entry => e !== null)
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)

  const currentFrom = addDays(today, -(REVIEW.windowDays - 1))
  const baselineFrom = addDays(currentFrom, -REVIEW.baselineDays)
  const current = figures(within(entries, currentFrom, tomorrow))
  const baselineFigures = figures(within(entries, baselineFrom, currentFrom))

  const earliest = entries.reduce<Date | null>((min, e) => (min === null || e.at < min ? e.at : min), null)
  const baselineDays = earliest ? Math.max(0, Math.min(REVIEW.baselineDays, daysBetween(earliest, currentFrom))) : 0
  const weeklyNorm = baselineDays > 0 ? baselineFigures.count / (baselineDays / REVIEW.windowDays) : null
  const baseline = { ...baselineFigures, days: baselineDays, weeklyNorm }

  // Three signals against the user's own baseline, never an absolute target.
  const output: Signal = weeklyNorm && weeklyNorm > 0
    ? (current.count + EPS >= weeklyNorm * (1 + REVIEW.outputShift) ? 1 : current.count - EPS <= weeklyNorm * (1 - REVIEW.outputShift) ? -1 : 0)
    : 0
  const shareSignal = (now_: number | null, base: number | null, shift: number, sample: [number, number], flip: boolean): Signal => {
    if (now_ === null || base === null) return 0
    if (sample[0] < REVIEW.minCurrent || sample[1] < REVIEW.minBaseline) return 0
    const diff = (flip ? -1 : 1) * (now_ - base)
    return diff + EPS >= shift ? 1 : -diff + EPS >= shift ? -1 : 0
  }
  const inTimebox = shareSignal(current.inTimeboxShare, baseline.inTimeboxShare, REVIEW.inTimeboxShift, [current.boxed, baseline.boxed], false)
  const unplanned = shareSignal(current.unplannedShare, baseline.unplannedShare, REVIEW.unplannedShift, [current.count, baseline.count], true)
  const score = output + inTimebox + unplanned

  const validBaseline = baselineDays >= REVIEW.minBaselineDays && baseline.count >= REVIEW.minBaselineTasks
  const state: ReviewState = entries.length === 0
    ? 'empty'
    : !validBaseline ? 'thin' : current.count === 0 ? 'quiet' : 'verdict'
  const verdict: Verdict | null = state === 'verdict' ? (score > 0 ? 'better' : score < 0 ? 'harder' : 'usual') : null

  // Weekly series, oldest first; the newest window is the verdict's current window.
  const weeks: WeekPoint[] = []
  for (let w = REVIEW.weeks - 1; w >= 0; w--) {
    const start = addDays(currentFrom, -w * REVIEW.windowDays)
    const end = addDays(start, REVIEW.windowDays)
    const f = figures(within(entries, start, end))
    const dayEndValues = dayEndValuesIn(dayEnd, start, end)
    weeks.push({
      start, end, tasks: f.count, boxed: f.boxed, seconds: f.seconds,
      inTimeboxShare: f.boxed >= REVIEW.minWeekBoxed ? f.inTimeboxShare : null,
      dayEndDays: dayEndValues.length,
      dayEndOpen: dayEndValues.length >= REVIEW.minDayEndDays
        ? Math.round((dayEndValues.reduce((sum, v) => sum + v, 0) / dayEndValues.length) * 10) / 10
        : null,
    })
  }

  const patternFrom = addDays(today, -(REVIEW.patternDays - 1))
  const patternEntries = within(entries, patternFrom, tomorrow)
  const boxedInPatternWindow = patternEntries.filter(e => isBoxed(e.record))
  const longer = boxedInPatternWindow.filter(e => e.record.estimationAccuracy! > IN_TIMEBOX_MAX_ACCURACY).length
  const shorter = boxedInPatternWindow.filter(e => e.record.estimationAccuracy! < REVIEW.shorterBelow).length
  const nBoxed = boxedInPatternWindow.length
  const pct = (n: number) => (nBoxed ? (n / nBoxed) * 100 : 0)

  const outlierFrom = addDays(today, -(REVIEW.outlierDays - 1))
  const outliers = within(entries, outlierFrom, tomorrow)
    .filter(e => isBoxed(e.record))
    .map(e => ({ record: e.record, overSeconds: e.record.actualTimeSpentSeconds - e.record.timeBoxSeconds! }))
    .filter(o => o.overSeconds > 0)
    .sort((a, b) => b.overSeconds - a.overSeconds)
    .slice(0, REVIEW.outliersShown)

  const splitEntries = within(entries, addDays(today, -(REVIEW.splitDays - 1)), tomorrow)
  const split = {
    taskCount: splitEntries.length,
    seconds: splitEntries.reduce((s, e) => s + e.record.actualTimeSpentSeconds, 0),
    unplannedShare: splitEntries.length ? (splitEntries.filter(e => e.record.isUnplanned).length / splitEntries.length) * 100 : null,
    byTopic: slicesOf(splitEntries, r => r.topic || NO_TOPIC),
    byActivity: slicesOf(splitEntries, r => r.activity || NO_ACTIVITY),
  }

  return {
    state,
    verdict,
    signals: { output, inTimebox, unplanned },
    recordCount: entries.length,
    hasTimeboxes: entries.some(e => isBoxed(e.record)),
    current,
    baseline,
    weeks,
    trend: trendOf(weeks),
    patterns: patternsOf(patternEntries),
    estimate: { n: nBoxed, longer: pct(longer), shorter: pct(shorter), onTarget: pct(nBoxed - longer - shorter) },
    outliers,
    split,
  }
}
