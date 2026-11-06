/**
 * @composable useDayClose
 * @description Shared open state and read-only data for the closing step (#98). The Mehr panel row, the Erledigt CTA and
 * the command palette open the same dialog (mounted once in pages/tasks.vue); no route, nothing persisted.
 * `useDayCloseData` selects what the dialog shows from the tasks store and never mutates it.
 * @responsibility Open/close, focus capture and restore; `finish` ("Fertig"): stop the timer of the Jetzt task and
 * move it back to Offen through the shared move path (the only side effect of the dialog; plain `close` has none);
 * today's done tasks, their summed time and the Offen/Jetzt/Wartet tasks.
 */
import { computed, readonly, ref } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { resumeTaskTimer } from '~/composables/useTaskTimerDriver'
import { sumTimeSpent } from '~/utils/dayClose'

// Module-level: one dialog per app. `typeof document` guards (not import.meta.client) keep this unit-testable.
const isOpen = ref(false)
let returnFocusTo: HTMLElement | null = null

export function useDayClose() {
  const tasksStore = useTasksStore()
  const { stopTimer, moveTaskToStatus } = useTaskOperations()

  function open(): void {
    if (isOpen.value) return
    returnFocusTo = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
  }

  /**
   * "Fertig": the user stops working for the day. Stops the running timer of the Jetzt task (flushes its pending
   * time to the upstream once) and moves it to Offen via moveTaskToStatus (board order, upstream status, WIP rule).
   * Time spent is kept. Closes first so a slow sync never holds the dialog open. Nothing in Jetzt: just closes.
   */
  async function finish(): Promise<void> {
    const ids = tasksStore.tasksProgress.map(task => task.id)
    for (const id of ids) stopTimer(id)
    close()
    try {
      await Promise.all(ids.map(id => moveTaskToStatus(id, TaskStatus.Open)))
    } finally {
      // A move that failed leaves its task in Jetzt: it keeps counting
      for (const id of ids) resumeTaskTimer(id)
    }
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
    const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
    if (!board) return
    board.setAttribute('tabindex', '-1')
    board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
    board.focus({ preventScroll: true })
  }

  return { isOpen: readonly(isOpen), open, close, finish, restoreFocus }
}

/** What the dialog shows. Reads the local cache only; recomputes when a sync lands. */
export function useDayCloseData() {
  const tasksStore = useTasksStore()

  /** Completed today (local day), archived excluded: the store's own "done today" rule. */
  const done = computed(() => tasksStore.tasksDoneToday)
  const totalSeconds = computed(() => sumTimeSpent(done.value))
  /** The task(s) "Fertig" puts back into Offen (the WIP limit makes it at most one). */
  const progress = computed(() => tasksStore.tasksProgress)
  /** Offen, Jetzt, Wartet in column order. */
  const inFlight = computed(() => [
    ...tasksStore.tasksOpen,
    ...tasksStore.tasksProgress,
    ...tasksStore.tasksWaiting,
  ])

  return { done, totalSeconds, inFlight, progress }
}
