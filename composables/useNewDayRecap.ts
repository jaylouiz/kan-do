/**
 * @composable useNewDayRecap
 * @description The "Kurzer Rückblick" on the first start of a new day (#385): decides whether the recap is due,
 * owns its open state and the snapshot it shows, and runs the one action when the user leaves it. State is
 * module-level so the page, the overlay and the board share it.
 * @responsibility
 * - `check(routeName)`: called by `pages/tasks.vue` on mount and on every return to the app (`listenForReturn`: window focus,
 *   tab visible; #242), never awaited. It syncs the shared "today" first. Opens the recap when the board is
 *   onboarded, the data status does not block writes, `lastShownDay` is a day before today and there are
 *   done-before-today tasks. A missing or malformed marker is the baseline: write today once, show nothing
 *   (skipped while the data status blocks, ADR 011). The day key is computed once here, so a midnight
 *   crossed while the window stays focused never opens it; the next return does.
 * - The snapshot is a copy taken at open: a fetch landing later changes nothing in the page.
 * - `leave()` (button, Escape): archives the snapshot ids still done before today when "Erledigte archivieren" is on
 *   (shared path with the board button; no toast, no undo, #463), moves the marker to the day the recap opened on, closes.
 * - `finishLeave()` after the fade-out: drops the snapshot and hands focus to the board, never to <body>.
 */
import { computed, readonly, ref } from 'vue'
import { syncToday } from '~/composables/useToday'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useDayClose } from '~/composables/useDayClose'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { dataState } from '~/lib/dataStorage'
import { newestCompletedAt } from '~/utils/doneDayLabel'
import { dayKey, isRecapDue, recapWhen, type RecapWhen } from '~/utils/recapDay'
import type { Task } from '~/types/task'

/** What the page shows; plain copies taken when the recap opens. */
export interface RecapSnapshot {
  /** Done before today, not archived; oldest completion first. */
  done: Task[]
  /** Jetzt, Offen, Wartet. */
  undone: Task[]
  when: RecapWhen
  /** Local day the recap opened on; becomes `lastShownDay` when it is left. */
  dayKey: string
}

const isOpen = ref(false)
const snapshot = ref<RecapSnapshot | null>(null)

/** Test seam: a fresh app start. */
export function resetNewDayRecap(): void {
  isOpen.value = false
  snapshot.value = null
}

const completedTime = (task: Task) => new Date(task.completedAt ?? 0).getTime()
const copyTask = (task: Task): Task => ({ ...task, custom: task.custom ? { ...task.custom } : task.custom })

export function useNewDayRecap() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const recapStore = useDayRecapStore()
  const { archiveTasks } = useArchiveDoneTasks()
  const dayClose = useDayClose()

  /** Desktop only: nothing is written or archived while the data file is in conflict or unavailable. */
  const writesBlocked = () => dataState.available && dataState.status !== 'ok'

  function check(routeName: unknown): void {
    // never modal on modal: an evening day-close dialog still open waits for the next return
    if (isOpen.value || routeName !== 'tasks' || dayClose.isOpen.value) return
    // the done-before-today list reads the shared "today": bring it up to date before looking at it (#242)
    syncToday()
    if (boardStore.boardConfig.sources === null) return
    if (writesBlocked()) return

    const now = new Date()
    const todayKey = dayKey(now)
    const lastShown = recapStore.validLastShownDay
    if (lastShown === null) {
      recapStore.markShown(todayKey)
      return
    }
    if (!isRecapDue(lastShown, todayKey)) return

    const done = [...tasksStore.tasksDonePrevious].sort((a, b) => completedTime(a) - completedTime(b)).map(copyTask)
    if (done.length === 0) return
    const newest = newestCompletedAt(done)
    if (!newest) return

    snapshot.value = {
      done,
      undone: [...tasksStore.tasksProgress, ...tasksStore.tasksOpen, ...tasksStore.tasksWaiting].map(copyTask),
      when: recapWhen(newest, now),
      dayKey: todayKey,
    }
    isOpen.value = true
  }

  /**
   * Runs `check` whenever the app is shown or focused again (#242): a hidden desktop window or a restored tab does not
   * remount the page, so the first return on a new day would otherwise wait for a click or navigation. A window that
   * stays focused across midnight is never interrupted. Returns the function that removes the listeners.
   */
  function listenForReturn(routeName: () => unknown): () => void {
    if (typeof window === 'undefined') return () => {}
    const onReturn = () => check(routeName())
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') onReturn()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }

  /** "Weiter zum Board", also Escape: the switch decides whether the done tasks are archived. */
  function leave(): void {
    const current = snapshot.value
    if (!isOpen.value || !current) return
    // The data file went into conflict or became unavailable while the recap was open: close, write nothing
    if (writesBlocked()) {
      isOpen.value = false
      return
    }
    // A fetch may have reopened or deleted one since the snapshot: only what is still done before today goes
    const stillDone = new Set(tasksStore.tasksDonePrevious.map(task => task.id))
    const ids = recapStore.archiveDone ? current.done.map(task => task.id).filter(id => stillDone.has(id)) : []
    recapStore.markShown(current.dayKey)
    isOpen.value = false
    archiveTasks(ids)
  }

  /** After the leave transition: the page no longer needs its snapshot; focus goes to the board region. */
  function finishLeave(options: { restoreFocus?: boolean } = {}): void {
    snapshot.value = null
    if (options.restoreFocus !== false) restoreFocus()
  }

  function restoreFocus(): void {
    if (typeof document === 'undefined') return
    const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
    if (!board) return
    board.setAttribute('tabindex', '-1')
    board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
    board.focus({ preventScroll: true })
  }

  return { isOpen: readonly(isOpen), snapshot: computed(() => snapshot.value), check, listenForReturn, leave, finishLeave }
}
