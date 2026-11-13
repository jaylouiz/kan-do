/**
 * @module dayClose
 * @description Pure helpers for the closing step (#98, #237): time sums, the time box fact and bar, and
 * the plain-markdown summary. No store, no i18n runtime: labels and the duration formatter are injected,
 * so the summary is testable and written in the locale the caller passes.
 */
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/** Cumulative time of the given tasks (per-task total, not "time worked today"). */
export function sumTimeSpent(tasks: readonly Pick<Task, 'timeSpentSeconds'>[]): number {
  return tasks.reduce((sum, task) => sum + (task.timeSpentSeconds || 0), 0)
}

/** Spent and planned time closer than this count as "in the time box" (5 min). */
export const TIMEBOX_TOLERANCE_SECONDS = 300

/** More boxed tasks than this are drawn as one aggregated segment (#237 D3). */
export const MAX_BAR_SEGMENTS = 10

type Boxed = Pick<Task, 'timeSpentSeconds' | 'timeBoxSeconds'>

/** A task has a time box that counts for the closing sheet only when time was tracked against it. */
export function hasTimeBoxFact<T extends Boxed>(task: T): task is T & { timeBoxSeconds: number } {
  return !!task.timeBoxSeconds && task.timeBoxSeconds > 0 && task.timeSpentSeconds > 0
}

export type TimeBoxState = 'none' | 'within' | 'under' | 'over'

/** How a done task compares with its time box: `minutes` is the rounded difference for `under` and `over`. */
export function timeBoxFact(task: Boxed): { state: TimeBoxState, minutes: number } {
  if (!hasTimeBoxFact(task)) return { state: 'none', minutes: 0 }
  const diff = task.timeSpentSeconds - task.timeBoxSeconds
  if (Math.abs(diff) < TIMEBOX_TOLERANCE_SECONDS) return { state: 'within', minutes: 0 }
  return { state: diff > 0 ? 'over' : 'under', minutes: Math.round(Math.abs(diff) / 60) }
}

/** One bar segment: `weight` is its share of the bar, `filled` and `overrun` are shares (0 to 1) of the segment itself. */
export interface TimeBoxSegment {
  key: string
  weight: number
  filled: number
  overrun: number
}

export interface TimeBoxBar {
  segments: TimeBoxSegment[]
  /** Tasks with a time box (the caption's n). */
  total: number
  /** Tasks not over their box (the caption's k). */
  kept: number
}

/**
 * The bar for today's done tasks: one segment per boxed task, as long as the segments stay readable; beyond
 * `MAX_BAR_SEGMENTS` one aggregated segment (summed time inside the boxes, summed overrun). The caption counts
 * tasks either way. No boxed task: no segments.
 */
export function timeBoxBar(done: readonly (Boxed & { id: string })[]): TimeBoxBar {
  const boxed = done.filter(hasTimeBoxFact)
  const kept = boxed.filter(task => timeBoxFact(task).state !== 'over').length
  const parts = boxed.map(task => ({
    key: task.id,
    weight: Math.max(task.timeSpentSeconds, task.timeBoxSeconds),
    inside: Math.min(task.timeSpentSeconds, task.timeBoxSeconds),
    over: Math.max(0, task.timeSpentSeconds - task.timeBoxSeconds),
  }))
  const segment = (key: string, items: typeof parts): TimeBoxSegment => {
    const weight = items.reduce((sum, item) => sum + item.weight, 0)
    return {
      key,
      weight,
      filled: items.reduce((sum, item) => sum + item.inside, 0) / weight,
      overrun: items.reduce((sum, item) => sum + item.over, 0) / weight,
    }
  }
  const segments = parts.length > MAX_BAR_SEGMENTS
    ? [segment('all', parts)]
    : parts.map(part => segment(part.key, [part]))
  return { segments, total: boxed.length, kept }
}

export interface DaySummaryLabels {
  /** Heading line, already containing the date. */
  heading: string
  done: string
  nothingDone: string
  total: (time: string) => string
  inFlight: string
  nothingInFlight: string
  columns: { open: string, progress: string, waiting: string }
}

export interface DaySummaryInput {
  labels: DaySummaryLabels
  formatDuration: (seconds: number) => string
  /** Tasks completed today, in display order. */
  done: readonly Task[]
  /** Offen, Jetzt and Wartet tasks. */
  inFlight: readonly Task[]
}

const oneLine = (title: string) => title.replace(/\s+/g, ' ').trim()

/** Plain markdown: date heading, done titles with time, total, in-flight titles by column. No notes. */
export function buildDaySummaryMarkdown({ labels, formatDuration, done, inFlight }: DaySummaryInput): string {
  const lines: string[] = [`# ${labels.heading}`, '']

  lines.push(`## ${labels.done}`, '')
  if (done.length === 0) {
    lines.push(labels.nothingDone, '')
  }
  else {
    for (const task of done) {
      const time = task.timeSpentSeconds > 0 ? ` (${formatDuration(task.timeSpentSeconds)})` : ''
      lines.push(`- ${oneLine(task.title)}${time}`)
    }
    lines.push('')
    const total = sumTimeSpent(done)
    if (total > 0) lines.push(labels.total(formatDuration(total)), '')
  }

  lines.push(`## ${labels.inFlight}`, '')
  if (inFlight.length === 0) {
    lines.push(labels.nothingInFlight, '')
  }
  else {
    const groups: [TaskStatus, string][] = [
      [TaskStatus.Open, labels.columns.open],
      [TaskStatus.Progress, labels.columns.progress],
      [TaskStatus.Waiting, labels.columns.waiting],
    ]
    for (const [status, label] of groups) {
      const column = inFlight.filter(task => task.status === status)
      if (column.length === 0) continue
      lines.push(`### ${label}`, '')
      for (const task of column) lines.push(`- ${oneLine(task.title)}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}
