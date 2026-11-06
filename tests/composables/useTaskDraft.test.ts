import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'

describe('useTaskDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useTaskDraft().clearDraft()
  })

  it('has no draft until started', () => {
    expect(useTaskDraft().draftTask.value).toBeNull()
  })

  it('starts as an empty Open task', () => {
    const { startDraft, draftTask } = useTaskDraft()
    startDraft()
    expect(draftTask.value).toMatchObject({ title: '', status: TaskStatus.Open, topic: null, timeBoxSeconds: null })
  })

  it('starts a Progress draft for the add-and-start flow (#125)', () => {
    const { startDraft, draftTask } = useTaskDraft()
    startDraft(TaskStatus.Progress)
    expect(draftTask.value).toMatchObject({ title: '', status: TaskStatus.Progress, timeSpentSeconds: 0 })
  })

  it('keeps the draft status when the form sends updates', () => {
    const { startDraft, updateDraft, draftTask } = useTaskDraft()
    startDraft(TaskStatus.Progress)
    updateDraft({ title: 'Call back', timeSpentSeconds: 12 })
    expect(draftTask.value).toMatchObject({ title: 'Call back', status: TaskStatus.Progress, timeSpentSeconds: 12 })
  })

  it('remembers whether the draft ended in a save', () => {
    const { startDraft, clearDraft, draftSaved } = useTaskDraft()
    startDraft()
    clearDraft({ saved: true })
    expect(draftSaved.value).toBe(true)
    startDraft()
    expect(draftSaved.value).toBe(false)
    clearDraft()
    expect(draftSaved.value).toBe(false)
  })

  it('tracks a running save until the draft clears or the save fails', () => {
    const { startDraft, clearDraft, setDraftSaving, draftSaving } = useTaskDraft()
    startDraft(TaskStatus.Progress)
    expect(draftSaving.value).toBe(false)
    setDraftSaving(true)
    expect(draftSaving.value).toBe(true)
    setDraftSaving(false)
    expect(draftSaving.value).toBe(false)
    setDraftSaving(true)
    clearDraft({ saved: true })
    expect(draftSaving.value).toBe(false)
  })

  it('merges live form updates', () => {
    const { startDraft, updateDraft, draftTask } = useTaskDraft()
    startDraft()
    updateDraft({ title: 'Write spec', topic: 'Work', priority: 3, timeBoxSeconds: 1800 })
    expect(draftTask.value).toMatchObject({ title: 'Write spec', topic: 'Work', priority: 3, timeBoxSeconds: 1800 })
  })

  it('ignores updates when no draft is active', () => {
    const { updateDraft, draftTask } = useTaskDraft()
    updateDraft({ title: 'x' })
    expect(draftTask.value).toBeNull()
  })

  it('clears the draft', () => {
    const { startDraft, clearDraft, draftTask } = useTaskDraft()
    startDraft()
    clearDraft()
    expect(draftTask.value).toBeNull()
  })

  it('never touches the tasks store', () => {
    const store = useTasksStore()
    const { startDraft, updateDraft } = useTaskDraft()
    startDraft()
    updateDraft({ title: 'Draft only' })
    expect(store.tasks.length).toBe(0)
  })
})
