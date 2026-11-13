import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import {
  MAX_BAR_SEGMENTS,
  buildDaySummaryMarkdown,
  sumTimeSpent,
  timeBoxBar,
  timeBoxFact,
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

describe('timeBoxFact (#237)', () => {
  const fact = (spent: number, box: number | null) => timeBoxFact({ timeSpentSeconds: spent, timeBoxSeconds: box })

  it('is none without a time box or without tracked time', () => {
    expect(fact(600, null).state).toBe('none')
    expect(fact(600, 0).state).toBe('none')
    expect(fact(0, 3600).state).toBe('none')
  })

  it('is within when spent and planned are less than 5 minutes apart', () => {
    expect(fact(3600, 3600)).toEqual({ state: 'within', minutes: 0 })
    expect(fact(3600 + 299, 3600).state).toBe('within')
    expect(fact(3600 - 299, 3600).state).toBe('within')
  })

  it('is under or over from 5 minutes on, with the rounded difference', () => {
    expect(fact(3600 - 300, 3600)).toEqual({ state: 'under', minutes: 5 })
    expect(fact(3600 + 300, 3600)).toEqual({ state: 'over', minutes: 5 })
    expect(fact(2700, 3600)).toEqual({ state: 'under', minutes: 15 })
    expect(fact(4500, 3600)).toEqual({ state: 'over', minutes: 15 })
  })
})

describe('timeBoxBar (#237)', () => {
  const done = (id: string, spent: number, box: number | null) => ({ id, timeSpentSeconds: spent, timeBoxSeconds: box })

  it('has no segments without a boxed task', () => {
    expect(timeBoxBar([done('a', 600, null), done('b', 0, 3600)])).toEqual({ segments: [], total: 0, kept: 0 })
  })

  it('draws one segment per boxed task: length is the larger of spent and box, the tail is the overrun', () => {
    const bar = timeBoxBar([done('a', 4500, 3600), done('b', 2700, 3600), done('x', 900, null)])
    expect(bar.segments.map(s => s.key)).toEqual(['a', 'b'])
    expect(bar.segments[0]).toMatchObject({ weight: 4500, filled: 3600 / 4500, overrun: 900 / 4500 })
    expect(bar.segments[1]).toMatchObject({ weight: 3600, filled: 2700 / 3600, overrun: 0 })
  })

  it('counts a task as kept unless its fact is over, so the caption and the rows agree', () => {
    const bar = timeBoxBar([done('a', 4500, 3600), done('b', 3600 + 299, 3600), done('c', 1200, 3600)])
    expect(bar.total).toBe(3)
    expect(bar.kept).toBe(2)
  })

  it('aggregates into one segment above the segment cap and still counts tasks', () => {
    const many = Array.from({ length: MAX_BAR_SEGMENTS + 1 }, (_, i) => done(`t${i}`, i === 0 ? 4200 : 600, 600))
    const bar = timeBoxBar(many)
    expect(bar.segments).toHaveLength(1)
    expect(bar.total).toBe(MAX_BAR_SEGMENTS + 1)
    expect(bar.kept).toBe(MAX_BAR_SEGMENTS)
    const weight = 4200 + 600 * MAX_BAR_SEGMENTS
    expect(bar.segments[0]).toMatchObject({ weight, filled: (600 * (MAX_BAR_SEGMENTS + 1)) / weight, overrun: 3600 / weight })
    expect(timeBoxBar(many.slice(0, MAX_BAR_SEGMENTS)).segments).toHaveLength(MAX_BAR_SEGMENTS)
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
