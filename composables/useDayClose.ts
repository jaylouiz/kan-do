/**
 * @composable useDayClose
 * @description Shared open state and read-only data for the closing step (#98). The Mehr panel row, the Erledigt CTA and
 * the command palette open the same dialog (mounted once in pages/tasks.vue); no route, nothing persisted.
 * `useDayCloseData` selects what the dialog shows from the tasks store and never mutates it.
 * @responsibility Open/close, focus capture and restore; the selection of open tasks (#237: every open task carries on
 * unless it is deselected; a set of *deselected* ids, local to the open dialog, cleared on every `open()`);
 * `finish` ("Fertig"): a selected Jetzt task stops its timer and goes back to Offen through the shared move path, each
 * deselected task is deleted through the upstream-aware delete (trash, board undo window), and every task in Erledigt
 * (today's and the earlier ones of the yesterday note) is archived through the shared archive path after the list's short
 * fade (#292); the only side effects of the dialog, plain `close` has none; today's done tasks, their summed time and the Offen/Jetzt/Wartet tasks.
 */
import { computed, nextTick, readonly, ref } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import type { Task } from '~/types/task'
import { resumeTaskTimer } from '~/composables/useTaskTimerDriver'
import { sumTimeSpent } from '~/utils/dayClose'

// Module-level: one dialog per app. `typeof document` guards (not import.meta.client) keep this unit-testable.
const isOpen = ref(false)
let returnFocusTo: HTMLElement | null = null
/** Open tasks the user took off tomorrow's board in the open dialog (#237). New tasks default to carrying on. */
const deselectedIds = ref<string[]>([])

/** The day as the dialog showed it when "Fertig" was pressed: the archive must not empty the dialog while it leaves. */
const closing = ref<{ done: Task[], inFlight: Task[] } | null>(null)

/** How long the Erledigt list fades before its tasks are archived (#292): `--duration-base`, mirrored here. */
export const DONE_LEAVE_MS = 200

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useDayClose() {
  const tasksStore = useTasksStore()
  const { stopTimer, moveTaskToStatus } = useTaskOperations()
  const { deleteTaskWithUndo } = useTaskDeletion()
  const boardStore = useBoardStore()
  const { archiveTasks: archivePath } = useArchiveDoneTasks()
  const recapStore = useDayRecapStore()

  /** The shared archive path, remembered for the next morning's recap. */
  function archiveTasks(ids: string[]): void {
    recapStore.rememberClosed(ids)
    archivePath(ids)
  }

  function open(): void {
    if (isOpen.value) return
    returnFocusTo = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
    deselectedIds.value = []
    closing.value = null
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
  }

  /** Whether the open task carries on to tomorrow (the checkbox state). */
  function isKept(taskId: string): boolean {
    return !deselectedIds.value.includes(taskId)
  }

  function setKept(taskId: string, kept: boolean): void {
    const without = deselectedIds.value.filter(id => id !== taskId)
    deselectedIds.value = kept ? without : [...without, taskId]
  }

  /**
   * "Fertig": the user stops working for the day. Selected tasks stay; a selected Jetzt task stops its running
   * timer (flushes its pending time to the upstream once) and moves to Offen via moveTaskToStatus (board order,
   * upstream status, WIP rule), time spent is kept. Each deselected task is deleted through `deleteTaskWithUndo`
   * (the one upstream-aware delete: trash, a 5 s undo window on the board; it stops a timer itself). Closes first
   * so a slow sync never holds the dialog open. A second call finds the deleted tasks gone and deletes nothing again.
   * Erledigt is archived last of all, independent of the moves above: see `archiveDone`.
   */
  async function finish(): Promise<void> {
    const dropped = new Set(deselectedIds.value)
    const doomed = [...tasksStore.tasksOpen, ...tasksStore.tasksProgress, ...tasksStore.tasksWaiting]
      .map(task => task.id)
      .filter(id => dropped.has(id))
    const ids = tasksStore.tasksProgress.map(task => task.id).filter(id => !dropped.has(id))
    if (isOpen.value) {
      closing.value = {
        done: tasksStore.tasksDoneToday.map(task => ({ ...task })),
        inFlight: [...tasksStore.tasksOpen, ...tasksStore.tasksProgress, ...tasksStore.tasksWaiting].map(task => ({ ...task })),
      }
    }
    for (const id of ids) stopTimer(id)
    close()
    for (const id of doomed) deleteTaskWithUndo(id)
    archiveDone()
    try {
      await Promise.all(ids.map(id => moveTaskToStatus(id, TaskStatus.Open)))
    } finally {
      // A move that failed leaves its task in Jetzt: it keeps counting
      for (const id of ids) resumeTaskTimer(id)
    }
  }

  /**
   * Erledigt ends the day empty (#292): today's done tasks and the not yet acknowledged earlier ones (the yesterday note)
   * go through the one archive path ("Gesehen" uses it too; nothing is deleted). The list fades first
   * (`board.doneLeaving`, `DONE_LEAVE_MS`; none under reduced motion), then what is still done is archived. A call inside
   * the fade does nothing, so a double click archives once.
   */
  function archiveDone(): void {
    if (boardStore.doneLeaving) return
    const done = () => new Set([...tasksStore.tasksDoneToday, ...tasksStore.tasksDonePrevious].map(task => task.id))
    const ids = [...done()]
    if (ids.length === 0) return
    if (prefersReducedMotion() || typeof window === 'undefined') {
      archiveTasks(ids)
      return
    }
    boardStore.doneLeaving = true
    window.setTimeout(async () => {
      const stillDone = done()
      boardStore.doneLeaving = false
      archiveTasks(ids.filter(id => stillDone.has(id)))
      // the CTA leaves with the next render: look at focus only then
      await nextTick()
      focusBoardIfLost()
    }, DONE_LEAVE_MS)
  }

  /** The CTA the dialog returned focus to leaves with the tasks: focus goes to the board, never to <body>. */
  function focusBoardIfLost(): void {
    if (typeof document === 'undefined') return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    focusBoard()
  }

  function focusBoard(): void {
    const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
    if (!board) return
    board.setAttribute('tabindex', '-1')
    board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
    board.focus({ preventScroll: true })
  }

  /**
   * Called after the leave animation. Focus goes back to the trigger; when there is none (the palette
   * that opened the dialog is gone) it goes to the board, never to <body>.
   */
  function restoreFocus(): void {
    if (typeof document === 'undefined') return
    const trigger = returnFocusTo
    returnFocusTo = null
    if (trigger?.isConnected && trigger !== document.body) {
      trigger.focus({ preventScroll: true })
      return
    }
    focusBoard()
  }

  return { isOpen: readonly(isOpen), open, close, finish, restoreFocus, isKept, setKept, deselectedIds: readonly(deselectedIds) }
}

/** What the dialog shows. Reads the local cache only; recomputes when a sync lands; after "Fertig" it keeps the confirmed day until the dialog has left (the next `open()`). */
export function useDayCloseData() {
  const tasksStore = useTasksStore()

  /** Completed today (local day), archived excluded: the store's own "done today" rule. */
  const done = computed(() => closing.value?.done ?? tasksStore.tasksDoneToday)
  const totalSeconds = computed(() => sumTimeSpent(done.value))
  /** Offen, Jetzt, Wartet in column order. */
  const inFlight = computed(() => closing.value?.inFlight ?? [
    ...tasksStore.tasksOpen,
    ...tasksStore.tasksProgress,
    ...tasksStore.tasksWaiting,
  ])

  return { done, totalSeconds, inFlight }
}
