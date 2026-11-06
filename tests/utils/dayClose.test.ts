import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import {
  CLOSING_LINE_COUNT,
  buildDaySummaryMarkdown,
  closingLineIndex,
  sumTimeSpent,
  type DaySummaryLabels,
} from '~/utils/dayClose'

const task = (id: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: 'secret note', timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

const labels: DaySummaryLabels = {
  heading: 'Tagesabschluss, Donnerstag',
  done: 'Erledigt',
  nothingDone: 'Heute noch nichts erledigt.',
  total: time => `Gesamt: ${time}`,
  inFlight: 'Noch nicht erledigt',
  nothingInFlight: 'Nichts mehr offen.',
  columns: { open: 'Offen', progress: 'Jetzt', waiting: 'Wartet' },
}
const fmt = (s: number) => `${s}s`

describe('sumTimeSpent', () => {
  it('sums timeSpentSeconds and treats missing values as 0', () => {
    expect(sumTimeSpent([task('a', 3, { timeSpentSeconds: 60 }), task('b', 3, { timeSpentSeconds: 90 })])).toBe(150)
    expect(sumTimeSpent([])).toBe(0)
  })
})

describe('closingLineIndex', () => {
  it('is stable for a given local date and always within the list', () => {
    expect(closingLineIndex('2026-10-22')).toBe(closingLineIndex('2026-10-22'))
    for (let day = 1; day <= 60; day++) {
      const key = `2026-10-${String(day).padStart(2, '0')}`
      const i = closingLineIndex(key)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(CLOSING_LINE_COUNT)
    }
  })

  it('rotates through all lines over consecutive days', () => {
    const seen = new Set<number>()
    for (let day = 1; day <= 28; day++) seen.add(closingLineIndex(`2026-02-${String(day).padStart(2, '0')}`))
    expect(seen.size).toBe(CLOSING_LINE_COUNT)
  })
})

describe('buildDaySummaryMarkdown', () => {
  it('writes the heading, done titles with time, the total and in-flight titles by column, without notes', () => {
    const md = buildDaySummaryMarkdown({
      labels,
      formatDuration: fmt,
      done: [task('a', 3, { timeSpentSeconds: 600 }), task('b', 3, { timeSpentSeconds: 0 })],
      inFlight: [
        task('c', TaskStatus.Open),
        task('d', TaskStatus.Progress),
        task('e', TaskStatus.Waiting),
        task('f', TaskStatus.Open),
      ],
    })
    expect(md).toBe([
      '# Tagesabschluss, Donnerstag',
      '',
      '## Erledigt',
      '',
      '- Task a (600s)',
      '- Task b',
      '',
      'Gesamt: 600s',
      '',
      '## Noch nicht erledigt',
      '',
      '### Offen',
      '',
      '- Task c',
      '- Task f',
      '',
      '### Jetzt',
      '',
      '- Task d',
      '',
      '### Wartet',
      '',
      '- Task e',
      '',
    ].join('\n'))
    expect(md).not.toContain('secret note')
  })

  it('says so when nothing is done and omits the total when no time was spent', () => {
    const md = buildDaySummaryMarkdown({ labels, formatDuration: fmt, done: [task('a', 3)], inFlight: [] })
    expect(md).toContain('- Task a')
    expect(md).not.toContain('Gesamt')
    expect(md).toContain('Nichts mehr offen.')
    expect(md).not.toContain('### ')

    const empty = buildDaySummaryMarkdown({ labels, formatDuration: fmt, done: [], inFlight: [] })
    expect(empty).toContain('Heute noch nichts erledigt.')
    expect(empty).toContain('Nichts mehr offen.')
    expect(empty).not.toContain('Gesamt')
  })

  it('keeps titles on one line', () => {
    const md = buildDaySummaryMarkdown({ labels, formatDuration: fmt, done: [task('a', 3, { title: 'Line one\nline two' })], inFlight: [] })
    expect(md).toContain('- Line one line two')
  })
})
