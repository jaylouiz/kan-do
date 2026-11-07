/**
 * @composable useTaskSheet
 * @description Shared close flow for the task sheet that hosts /tasks/:id and /tasks/add
 * @responsibility
 * - Every close (Escape, overlay, swipe, Cancel, submit, delete) goes through `closeTaskSheet()`
 * - The sheet animates out first; the route changes to /tasks only after the leave animation
 * - Repeated close requests reuse the pending close instead of arming new timers
 * - A close may name the card that takes focus afterwards (the card just added, #125)
 */

import { ref, readonly } from 'vue';

/** Safety net in case the leave event never fires. */
const LEAVE_FALLBACK_MS = 600;

// Singleton state: one sheet per app (mounted in pages/tasks.vue)
const isDismissed = ref(false);
let pendingClose: Promise<void> | null = null;
let resolveClose: (() => void) | null = null;
let leaveFallback: ReturnType<typeof setTimeout> | undefined;
/** Card that receives focus once the sheet has closed; read once by `TaskSheet`. */
let returnFocusTaskId: string | null = null;

/** Wait for the history step of `router.back()` before giving up and replacing. */
const BACK_TIMEOUT_MS = 800;

/**
 * Leaves the sheet route without growing history (#22): `router.back()` when the entry before
 * the sheet is the board, else a replace (deep link, reload, opened from another page or sheet).
 */
const leaveSheetRoute = async () => {
  const router = useRouter();
  const back = (router.options.history.state as { back?: string | null } | undefined)?.back;
  if (back && back.split(/[?#]/)[0] === '/tasks') {
    const arrived = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { remove(); resolve(false); }, BACK_TIMEOUT_MS);
      const remove = router.afterEach(() => { clearTimeout(timer); remove(); resolve(true); });
    });
    router.back();
    if (await arrived) return;
  }
  await navigateTo('/tasks', { replace: true });
};

/**
 * Finishes a pending close: leaves the sheet route (back or replace to /tasks) and resolves waiting callers.
 * Called by the host on the sheet's leave event (or by the fallback timer).
 */
const finishClose = async () => {
  if (!pendingClose) return;
  clearTimeout(leaveFallback);
  const resolve = resolveClose;
  pendingClose = null;
  resolveClose = null;
  await leaveSheetRoute();
  resolve?.();
};

/**
 * Starts closing the sheet. Resolves once the sheet has left and the route is /tasks.
 * `focusTaskId` sends focus to that card instead of back to the opener (after a save).
 */
const closeTaskSheet = (options: { focusTaskId?: string } = {}): Promise<void> => {
  if (pendingClose) {
    // A repeated request (e.g. the sheet's own close echo after a save) keeps the target already named
    if (options.focusTaskId) returnFocusTaskId = options.focusTaskId;
    return pendingClose;
  }
  // A fresh close never inherits the target of an earlier one
  returnFocusTaskId = options.focusTaskId ?? null;
  isDismissed.value = true;
  pendingClose = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  leaveFallback = setTimeout(() => void finishClose(), LEAVE_FALLBACK_MS);
  return pendingClose;
};

/**
 * Re-arms the sheet after the route changed (a new task opened, history back/forward,
 * or back on /tasks). A close still pending from the previous route is dropped.
 */
const resetTaskSheet = () => {
  clearTimeout(leaveFallback);
  // A dropped close never reaches the sheet's close auto-focus, so its target must not outlive it
  if (pendingClose) returnFocusTaskId = null;
  resolveClose?.();
  pendingClose = null;
  resolveClose = null;
  isDismissed.value = false;
};

/** Returns the card named by the last close and forgets it, so it applies to one close only. */
const takeReturnFocusTaskId = (): string | null => {
  const id = returnFocusTaskId;
  returnFocusTaskId = null;
  return id;
};

export function useTaskSheet() {
  return {
    isDismissed: readonly(isDismissed),
    closeTaskSheet,
    finishClose,
    resetTaskSheet,
    takeReturnFocusTaskId,
  };
}
