/**
 * @composable useDeleteHold
 * @description Pointer and keyboard focus hold a delete's undo window open (#422): the clock stops while either is
 * inside the gap (or the day-close row) and restarts when both have left. Two flags per task, so the mouse leaving
 * does not resume the clock under a focused "Rückgängig", and the reverse.
 * @responsibility Per-task pointer/focus flags in front of `useTaskDeletion().pauseDelete/resumeDelete`, and a
 * release on unmount: browsers do not reliably fire `focusout` or `pointerleave` for a removed node (Escape closing the
 * day-close dialog while "Rückgängig" has focus), and a window left paused would never close.
 * @usage `const { hold, release } = useDeleteHold()`; `@pointerenter="hold(id, 'pointer', true)"`,
 * `@focusout="onFocusOut(id, $event)"`.
 */
import { onBeforeUnmount } from 'vue'
import { useTaskDeletion } from '~/composables/useTaskDeletion'

type HoldKind = 'pointer' | 'focus'

export function useDeleteHold() {
  const { pauseDelete, resumeDelete } = useTaskDeletion()
  const held = new Map<string, { pointer: boolean; focus: boolean }>()

  function hold(taskId: string, kind: HoldKind, on: boolean): void {
    const flags = held.get(taskId) ?? { pointer: false, focus: false }
    flags[kind] = on
    held.set(taskId, flags)
    if (flags.pointer || flags.focus) {
      pauseDelete(taskId)
    } else {
      held.delete(taskId)
      resumeDelete(taskId)
    }
  }

  /** Focus moving between elements inside the same container is not a leave. */
  function onFocusOut(taskId: string, event: FocusEvent): void {
    const container = event.currentTarget as Node | null
    if (container && event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
    hold(taskId, 'focus', false)
  }

  /** Resumes every window this component holds. */
  function release(): void {
    for (const taskId of [...held.keys()]) {
      held.delete(taskId)
      resumeDelete(taskId)
    }
  }

  onBeforeUnmount(release)

  return { hold, onFocusOut, release }
}
