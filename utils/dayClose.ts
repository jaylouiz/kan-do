/**
 * @module dayClose
 * @description Pure helpers for the closing step (#98): time sums, the date-stable closing line and
 * the plain-markdown summary. No store, no i18n runtime: labels and the duration formatter are injected,
 * so the summary is testable and written in the locale the caller passes.
 */
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/** Number of closing lines in the locale files (`dayClose.closing.line0` ... `lineN-1`). */
export const CLOSING_LINE_COUNT = 6

/** Cumulative time of the given tasks (per-task total, not "time worked today"). */
export function sumTimeSpent(tasks: readonly Pick<Task, 'timeSpentSeconds'>[]): number {
  return tasks.reduce((sum, task) => sum + (task.timeSpentSeconds || 0), 0)
}

/**
 * Index of the closing line for a local date key (YYYY-MM-DD). Consecutive days rotate through the
 * list; the same date always gives the same line.
 */
export function closingLineIndex(dateKey: string): number {
  const [year = 0, month = 0, day = 0] = dateKey.split('-').map(Number)
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  return ((dayNumber % CLOSING_LINE_COUNT) + CLOSING_LINE_COUNT) % CLOSING_LINE_COUNT
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
