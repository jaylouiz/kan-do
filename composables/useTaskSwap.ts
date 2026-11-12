/**
 * @composable useTaskSwap
 * @description The swap (#162): one task takes over "Jetzt" from the task that runs, which moves to
 * "Wartet". One function serves every path that swaps (the drop on the running card, the keyboard drag,
 * the task sheet's status field), so the move, the undo toast and the WIP rule live once.
 * - The decision is read from the store at call time (`canSwapIntoProgress`), never from what the caller saw
 * - Both moves are ordinary status writes (`useTaskSync().updateTaskStatus`, per task source): the running task
 *   leaves first, the incoming one follows, so "Jetzt" never holds two tasks. The Jetzt timer driver arms and
 *   disarms from the status, so the timers need no code here
 * - Tracked time and statistics are untouched: only moves into and out of Erledigt record anything, and undo
 *   never rolls time spent back (both tasks were really worked on)
 * - Undo works only while both tasks still sit where the swap left them; otherwise it does nothing
 * @responsibility Move, toast and undo of a swap; never decides how a drag looks (the drag state owns that)
 */
import { useToast } from '#imports'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskSync } from '~/composables/useTaskSync'
import { TaskStatus } from '~/types/taskStatus'
import { canSwapIntoProgress } from '~/utils/wipGuard'
import { translate } from '~/lib/i18n'

const TOAST_DURATION_MS = 6000
const TITLE_MAX_LENGTH = 34

const short = (title: string) => (title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH)}…` : title)

export function useTaskSwap() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { updateTaskStatus, handleSyncError } = useTaskSync()
  const toast = useToast()

  const columnOf = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.Open: return tasksStore.tasksOpen
      case TaskStatus.Waiting: return tasksStore.tasksWaiting
      default: return []
    }
  }

  /** The id of the task a swap would send to Wartet, or null when `taskId` cannot swap in right now. */
  function swapPartnerOf(taskId: string): string | null {
    const incoming = tasksStore.task(taskId)
    if (!incoming) return null
    const running = tasksStore.tasksProgress
    if (!canSwapIntoProgress({ incomingStatus: incoming.status, progressCount: running.length })) return null
    return running[0]?.id ?? null
  }

  const write = (taskId: string, status: TaskStatus, after?: Promise<unknown>) =>
    updateTaskStatus({ taskId, status, ...(after ? { after } : {}) })
      .catch(error => handleSyncError(error, `Failed to move ${taskId} to ${status}`))

  /**
   * Puts `taskId` into Jetzt and the running task into Wartet, with one undo toast.
   * @returns false when nothing swapped (the task is gone, not in Offen/Wartet, or Jetzt does not hold exactly one task)
   */
  function swapIntoProgress(taskId: string): boolean {
    const outgoingId = swapPartnerOf(taskId)
    const incoming = tasksStore.task(taskId)
    const outgoing = outgoingId ? tasksStore.task(outgoingId) : undefined
    if (!incoming || !outgoing) return false

    const incomingFrom = incoming.status
    const incomingIndex = columnOf(incomingFrom).findIndex(t => t.id === taskId)
    const previousIndex = incomingIndex >= 0 ? incomingIndex : null

    // The running task takes the slot the incoming card leaves in Wartet; from Offen it is placed by
    // the column's sorting (or appended). Locally both moves are synchronous, the running one first.
    boardStore.moveTaskToIndex(outgoing.id, TaskStatus.Waiting, TaskStatus.Progress, incomingFrom === TaskStatus.Waiting ? previousIndex : null)
    const leaving = write(outgoing.id, TaskStatus.Waiting)
    boardStore.updateTaskPosition(incoming.id, TaskStatus.Progress, incomingFrom)
    void write(incoming.id, TaskStatus.Progress, leaving)
    boardStore.startTimeboxNudge(incoming.id)

    const id = `swap-${incoming.id}`
    toast.add({
      id,
      title: translate('board.swap.title'),
      description: translate('board.swap.description', { running: short(incoming.title), waiting: short(outgoing.title) }),
      icon: 'i-ph-swap',
      color: 'neutral',
      duration: TOAST_DURATION_MS,
      actions: [
        {
          label: translate('common.undo'),
          color: 'primary',
          variant: 'solid',
          onClick: () => {
            toast.remove(id)
            undoSwap({ incomingId: incoming.id, outgoingId: outgoing.id, incomingFrom, previousIndex })
          },
        },
      ],
    })
    return true
  }

  /** Both tasks back where they were; a no-op once either has moved on since the swap. */
  function undoSwap(swap: { incomingId: string; outgoingId: string; incomingFrom: TaskStatus; previousIndex: number | null }): void {
    const incoming = tasksStore.task(swap.incomingId)
    const outgoing = tasksStore.task(swap.outgoingId)
    if (incoming?.status !== TaskStatus.Progress || outgoing?.status !== TaskStatus.Waiting) return
    boardStore.endTimeboxNudge(swap.incomingId)
    boardStore.moveTaskToIndex(swap.incomingId, swap.incomingFrom, TaskStatus.Progress, swap.previousIndex)
    const leaving = write(swap.incomingId, swap.incomingFrom)
    boardStore.updateTaskPosition(swap.outgoingId, TaskStatus.Progress, TaskStatus.Waiting)
    void write(swap.outgoingId, TaskStatus.Progress, leaving)
  }

  return { swapIntoProgress, swapPartnerOf }
}
