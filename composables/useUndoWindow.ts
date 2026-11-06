/**
 * @composable useUndoWindow
 * @description The undo window of an action that is applied locally at once and sent upstream only after its
 * undo toast has closed: delete (#99) and move to another source (#322). An open window per task and kind, a
 * poll that notices a toast which closed without reporting it (hover pauses the toast; newer toasts push it
 * out), and "closed means commit". Behaviour-preserving extraction from `useTaskDeletion`.
 *
 * Toastless mode (#422): `beginTimed` runs the window on its own timer, which `pause`/`resume` stop and restart
 * with the time that was left (the in-card gap pauses on hover and focus). `openIds`, `isPaused` and
 * `durationOf` are reactive, so the board can render the gaps from them.
 * @responsibility Window bookkeeping and the close check; the toast content and the commit stay with the caller.
 */
import { hasInjectionContext, ref } from 'vue'
import { useNuxtApp, useToast } from '#imports'

/** After the toast's own duration, re-check this often whether it has closed (hover pauses it). */
const TOAST_CLOSE_POLL_MS = 1000

interface OpenWindow {
  timer: ReturnType<typeof setTimeout> | null
  onClose: () => void
  /** Toastless windows only: the full length, when it ends (epoch ms) and whether it is paused. */
  timed?: { durationMs: number; endsAt: number; remainingMs: number; paused: boolean }
}

/** Windows whose undo toast is still open in this session (not persisted), by `<kind>:<taskId>`. */
const openWindows = new Map<string, OpenWindow>()

/** Bumped whenever a window opens, closes, pauses or resumes: what makes the getters below reactive. */
const revision = ref(0)
const touch = (): void => { revision.value += 1 }

type ToastApi = ReturnType<typeof useToast> & {
  toasts?: { value: Array<{ id: string | number; open?: boolean }> }
}

export function useUndoWindow(kind: string) {
  // Outside setup (e.g. called after an await), resolve the toast API in the app context.
  const toast: ToastApi = hasInjectionContext()
    ? useToast()
    : useNuxtApp().vueApp.runWithContext(() => useToast())

  const keyOf = (taskId: string): string => `${kind}:${taskId}`

  const isToastOpen = (toastId: string): boolean =>
    toast.toasts?.value.some(item => item.id === toastId && item.open !== false) ?? false

  /** Whether the task's window is open. */
  function isOpen(taskId: string): boolean {
    void revision.value
    return openWindows.has(keyOf(taskId))
  }

  /** Whether the task's toastless window is paused (hover or focus in the gap). */
  function isPaused(taskId: string): boolean {
    void revision.value
    return openWindows.get(keyOf(taskId))?.timed?.paused ?? false
  }

  /** The full length of the task's toastless window in ms; null when it has none. */
  function durationOf(taskId: string): number | null {
    void revision.value
    return openWindows.get(keyOf(taskId))?.timed?.durationMs ?? null
  }

  /** Ids of the tasks whose window of this kind is open. */
  function openIds(): string[] {
    void revision.value
    const prefix = `${kind}:`
    return [...openWindows.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
  }

  /** Ends the window without running `onClose` (an undo). Returns whether it was open. */
  function cancel(taskId: string): boolean {
    const open = openWindows.get(keyOf(taskId))
    if (!open) return false
    if (open.timer !== null) clearTimeout(open.timer)
    openWindows.delete(keyOf(taskId))
    touch()
    return true
  }

  /** Ends the window and runs `onClose`. Safe to call more than once. */
  function close(taskId: string): void {
    const open = openWindows.get(keyOf(taskId))
    if (!cancel(taskId) || !open) return
    open.onClose()
  }

  /**
   * Opens the window for `taskId`. After `delay` it checks whether the toast has closed: while it is still open
   * (hover pause) it checks again every second, once it is gone `onClose` runs. A toast that reports its close
   * (`onUpdate:open`) calls `close` itself.
   */
  function begin(taskId: string, toastId: string, delay: number, onClose: () => void): void {
    const schedule = (wait: number): void => {
      const timer = setTimeout(() => {
        if (isToastOpen(toastId)) schedule(TOAST_CLOSE_POLL_MS)
        else close(taskId)
      }, wait)
      openWindows.set(keyOf(taskId), { timer, onClose })
      touch()
    }
    schedule(delay)
  }

  /**
   * Opens a toastless window (#422): `onClose` runs after `delay` ms, the time `pause` holds back. Opening it
   * again for the same task replaces the earlier window without running its `onClose`.
   */
  function beginTimed(taskId: string, delay: number, onClose: () => void): void {
    cancel(taskId)
    const timer = setTimeout(() => close(taskId), delay)
    openWindows.set(keyOf(taskId), { timer, onClose, timed: { durationMs: delay, endsAt: Date.now() + delay, remainingMs: delay, paused: false } })
    touch()
  }

  /** Stops the clock of a toastless window and remembers what was left. */
  function pause(taskId: string): void {
    const open = openWindows.get(keyOf(taskId))
    if (!open?.timed || open.timed.paused) return
    if (open.timer !== null) clearTimeout(open.timer)
    open.timer = null
    open.timed.remainingMs = Math.max(0, open.timed.endsAt - Date.now())
    open.timed.paused = true
    touch()
  }

  /** Restarts a paused toastless window with the time that was left. */
  function resume(taskId: string): void {
    const open = openWindows.get(keyOf(taskId))
    if (!open?.timed?.paused) return
    open.timed.paused = false
    open.timed.endsAt = Date.now() + open.timed.remainingMs
    open.timer = setTimeout(() => close(taskId), open.timed.remainingMs)
    touch()
  }

  return { toast, begin, beginTimed, pause, resume, close, cancel, isOpen, isPaused, durationOf, openIds }
}

/** Test helper: forgets open undo windows between tests. */
export function resetUndoWindows(): void {
  openWindows.forEach((open) => { if (open.timer !== null) clearTimeout(open.timer) })
  openWindows.clear()
  touch()
}
