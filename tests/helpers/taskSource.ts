/**
 * Test helpers for the task source of fixtures (#326). A pre-#326 test sets "the" task service of the
 * board and then adds tasks; since sync now follows each task's own `source`, the fixtures must carry
 * the source the board was set to.
 */
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import type { SourceId } from '~/types/taskSource'

function activeSource(): SourceId {
  try {
    return useBoardStore().defaultSource ?? 'local'
  } catch {
    return 'local' // no active Pinia yet (module-level fixture)
  }
}

/** `source` + `externalId` of a task that lives in the board's default source (Local when none is set). */
export function sourceOf(id: string, source: SourceId = activeSource()) {
  return { source, externalId: source === 'local' ? null : id }
}

/** Makes `source` the board's only source and moves the tasks already on the board there. */
export function switchSource(source: SourceId | 'example') {
  const target: SourceId = source === 'example' ? 'local' : source
  useBoardStore().setSingleSource(target)
  const tasks = useTasksStore()
  for (const task of tasks.tasks) {
    Object.assign(task, sourceOf(task.id, target))
  }
}
