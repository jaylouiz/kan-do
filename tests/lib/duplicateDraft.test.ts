import { describe, expect, it } from 'vitest'
import { duplicateDraft } from '~/lib/duplicateDraft'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task: Task = {
  id: 'a', source: 'notion', externalId: 'page-1', status: TaskStatus.Done, title: 'Write report', activity: 'Writing',
  topic: 'Q4', topicColorCode: 'blue', priority: 3, notes: 'Numbers first', timeBoxSeconds: 1500, timeSpentSeconds: 900, timerId: 7,
  isUnplanned: true, completedAt: new Date('2026-11-01'), completedAtCorrected: true, archivedAt: new Date('2026-11-02'),
  pendingSync: { since: 1, attempts: 2, lastError: 'x' },
}

describe('duplicateDraft (#296)', () => {
  it('carries the content fields over', () => {
    expect(duplicateDraft(task)).toMatchObject({
      title: 'Write report', activity: 'Writing', topic: 'Q4', topicColorCode: 'blue', priority: 3, notes: 'Numbers first', timeBoxSeconds: 1500,
    })
  })

  it('starts fresh in Offen: no identity, no time, no done or sync state', () => {
    const draft = duplicateDraft(task)
    expect(draft.status).toBe(TaskStatus.Open)
    expect(draft.timeSpentSeconds).toBe(0)
    for (const key of ['id', 'externalId', 'source', 'timerId', 'completedAt', 'completedAtCorrected', 'archivedAt', 'pendingSync', 'pendingMove', 'custom'] as const) {
      expect(draft).not.toHaveProperty(key)
    }
  })

  it('keeps the unplanned flag of the original', () => {
    expect(duplicateDraft(task).isUnplanned).toBe(true)
    expect(duplicateDraft({ ...task, isUnplanned: undefined }).isUnplanned).toBe(false)
  })
})
