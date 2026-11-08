/**
 * @composable useTaskDeletion
 * @description The one upstream-aware delete (#99, #422), shared by the card context menu, the detail
 * sheet menu, the carried-over triage block, the day-close row and the command palette. Deleting acts at once,
 * without a question: the task leaves the board and its card turns into a gap in its own slot ("Im Papierkorb"
 * and "Rückgängig", `TaskDeletedGap`) for `DELETE_UNDO_WINDOW_MS`. Undo in the window puts the card back and
 * never touches the source. When the window closes the snapshot moves into the trash (`store/trash.ts`) and the
 * upstream call runs (Notion: archive the page, Todoist: delete the task), exactly as before the trash.
 *
 * App closed inside the window: the pending delete is persisted and closed on the next start
 * (`resumePendingDeletes`: trash entry and commit); closing the app is not an undo. Offline: the delete stays
 * queued and is committed on reconnect or the next start; the trash entry exists from the window's close.
 * @responsibility Gap state, undo window and local snapshot; the upstream commit lives in useTaskSync.
 */
import { translate } from '~/lib/i18n'
import { useTasksStore, type PendingTaskDelete } from '~/store/tasks'
import { useTrashStore } from '~/store/trash'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useBoardStore } from '~/store/board'
import { useTaskSync } from '~/composables/useTaskSync'
import { stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { resetUndoWindows, useUndoWindow } from '~/composables/useUndoWindow'
import { closingGaps, holdClosingGap, markTaskReturning, reanchorClosingGaps, resetDeleteGapState, withAfterId } from '~/lib/deleteGapState'
import { orderGaps, stackHeaderKey } from '~/utils/columnItems'
import { deriveGroupKeyForTask, shouldTaskBeGrouped } from '~/utils/taskGrouping'
import { mapHelpers } from '~/utils/mapHelpers'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

export const DELETE_UNDO_WINDOW_MS = 5000

/** Escapes an id for a CSS attribute selector (jsdom may lack `CSS.escape`). */
const cssEscape = (id: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'))

/** The collapsed stack on the board that holds the task as a member, with its member ids (#433). */
function findCollapsedStack(taskId: string): { stack: HTMLElement, memberIds: string[] } | null {
  for (const stack of document.querySelectorAll<HTMLElement>('.task-stack[data-stack-task-ids]')) {
    try {
      const memberIds: unknown = JSON.parse(stack.getAttribute('data-stack-task-ids') ?? '[]')
      if (Array.isArray(memberIds) && memberIds.includes(taskId)) return { stack, memberIds: memberIds.filter((id): id is string => typeof id === 'string') }
    } catch {
      // A malformed attribute is no stack we can place a gap at
    }
  }
  return null
}

/**
 * The anchor a board element offers a gap behind it: a gap by its task id, an expanded stack's header by its header
 * key (#438), a card or collapsed stack by its task id; null for anything else.
 */
function anchorOfElement(el: Element): string | null {
  const gapId = el.getAttribute('data-gap-id')
  if (gapId) return gapId
  const headerKey = el.getAttribute('data-stack-header')
  if (headerKey !== null) return stackHeaderKey(headerKey)
  const id = el.getAttribute('data-task-id')
  return id && (el.classList.contains('task-wrapper') || el.classList.contains('task-stack')) ? id : null
}

/**
 * Where the card's gap goes, read from the board's DOM before the card leaves it: the item before it in its
 * list (a card, a collapsed stack by its front task, another gap, or the header of its expanded stack, #438) and
 * its height. The gap hangs on exactly that item, a gap included (#477): the chain of gaps is the order the cards
 * stood in, and a card that returns from an undo is followed by the gaps that hung on it. A card inside a collapsed stack has no wrapper of its own (#433): its gap goes directly below the
 * stack, at the stack's measured height, anchored where the card stood in the group: the first member on the
 * group's header key, any other on the member before it (#457), so expanding the stack again shows the gap at the
 * card's place (`placeGaps` resolves a header key to the collapsed stack and any member to its stack; with one member
 * left it puts the gap directly before that lone card, #502). Only a stack without a group key has no header key to
 * hang the first member on: it anchors on the next member. `deleteTaskWithUndo` then moves the anchor behind the
 * gaps of the stack that already hang there, so the gaps keep the card order (#502).
 * Without any box on the DOM the gap goes to the column end at the default card height.
 */
export function measureSlot(taskId: string): NonNullable<PendingTaskDelete['slot']> {
  if (typeof document === 'undefined') return { height: null }
  const card = document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${cssEscape(taskId)}"]`)
  if (!card) {
    const found = findCollapsedStack(taskId)
    if (!found) return { height: null }
    const index = found.memberIds.indexOf(taskId)
    const groupKey = found.stack.getAttribute('data-stack-key')
    const anchor = index === 0
      ? groupKey === null ? found.memberIds.find(id => id !== taskId) : stackHeaderKey(groupKey)
      : found.memberIds[index - 1]
    if (anchor === undefined) return { height: null }
    return { afterId: anchor, height: found.stack.offsetHeight || null }
  }
  let previous = card.previousElementSibling
  while (previous) {
    // The first member of an expanded stack: its gap sits between the header and the next member (#438)
    const anchor = anchorOfElement(previous)
    if (anchor !== null) return { afterId: anchor, height: card.offsetHeight || null }
    previous = previous.previousElementSibling
  }
  return { afterId: null, height: card.offsetHeight || null }
}

/**
 * The group key of the collapsed stack the card is a member of (null = the stack carries none), or undefined when the
 * card has a box of its own on the board or stands in no collapsed stack: its gap then follows the DOM (#502).
 */
export function collapsedStackGroupKey(taskId: string): string | null | undefined {
  if (typeof document === 'undefined') return undefined
  if (document.querySelector(`.task-wrapper[data-task-id="${cssEscape(taskId)}"]`)) return undefined
  const found = findCollapsedStack(taskId)
  return found ? found.stack.getAttribute('data-stack-key') : undefined
}

/**
 * The anchor in front of an expanded group's last member: the first previous sibling of its card that is not a gap of
 * its own group (`isOwnGap`): a card or collapsed stack by its task id, a foreign gap by its id (the gap of the card
 * in front of the group, or the last gap of the previous stack, #477), null = first when only own gaps or nothing
 * precede it. #457: the gaps of the group's members hang on this once the group has no header, no stack and no other
 * member left.
 */
export function preGroupAnchor(taskId: string, isOwnGap: (gapId: string) => boolean = () => false): string | null {
  if (typeof document === 'undefined') return null
  const card = document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${cssEscape(taskId)}"]`)
  for (let previous = card?.previousElementSibling ?? null; previous; previous = previous.previousElementSibling) {
    const gapId = previous.getAttribute('data-gap-id')
    if (gapId !== null && isOwnGap(gapId)) continue
    const anchor = anchorOfElement(previous)
    if (anchor !== null) return anchor
  }
  return null
}

/**
 * Whether the card's own column list shows neither a header nor a collapsed stack of the group: nothing a header key
 * can resolve to. Scoped to the list the card stands in (or its collapsed stack): every column is in the DOM, and
 * expansion and group keys are per column, so a header or stack of the same topic in another column says nothing.
 */
export function groupHasNoHeaderOrStack(groupKey: string, taskId: string): boolean {
  if (typeof document === 'undefined') return false
  const card = document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${cssEscape(taskId)}"]`)
  const list = (card ?? findCollapsedStack(taskId)?.stack)?.parentElement
  if (!list) return false
  const key = cssEscape(groupKey)
  return !list.querySelector(`:scope > [data-stack-header="${key}"], :scope > .task-stack[data-stack-key="${key}"]`)
}

export function useTaskDeletion() {
  const tasksStore = useTasksStore()
  const trashStore = useTrashStore()
  const boardStore = useBoardStore()
  const { commitTaskDelete, updateTaskStatus } = useTaskSync()
  const undoWindow = useUndoWindow('delete')
  const { announceStack } = useStackExpansion()

  function undoDelete(taskId: string): void {
    const pending = mapHelpers.get(tasksStore.pendingDeletes, taskId)
    if (!pending || !undoWindow.cancel(taskId)) return
    tasksStore.removePendingDelete(taskId)
    tasksStore.undeleteTask(taskId, pending.task.externalId, pending.task.pendingMove?.fromExternalId)
    // Back in Jetzt only while Jetzt is free: it holds one card (WIP limit)
    const jetztTaken = pending.task.status === TaskStatus.Progress
      && tasksStore.tasks.some(other => other.status === TaskStatus.Progress)
    if (!tasksStore.task(taskId)) tasksStore.addTask(jetztTaken ? { ...pending.task, status: TaskStatus.Open } : pending.task)
    if (jetztTaken) {
      boardStore.updateTaskPosition(taskId, TaskStatus.Open, TaskStatus.Progress)
      void updateTaskStatus({ taskId, status: TaskStatus.Open, skipLocalUpdate: true })
    } else if (pending.orderIndex !== undefined && pending.orderIndex !== null) {
      // The column's order may have forgotten the task meanwhile: back to where it stood
      const status = pending.fromStatus ?? pending.task.status
      boardStore.moveTaskToIndex(taskId, status, status, pending.orderIndex)
    }
    tasksStore.restoreCarryOver(taskId, pending.carryOver)
    markTaskReturning(taskId)
  }

  /** The task's place in its column's manual order, so an undo can put it back there. */
  function orderIndexOf(taskId: string, status: TaskStatus): number | null {
    const index = boardStore.columnByTaskStatus(status)?.taskOrder.indexOf(taskId) ?? -1
    return index === -1 ? null : index
  }

  /** The trash entry of a delete whose window closed (once per delete). */
  function moveToTrash(pending: PendingTaskDelete): void {
    if (pending.state !== 'waiting' || trashStore.entry(pending.taskId)) return
    // The tracked time of a task deleted before completion is kept for the Statistik page (#537)
    useTaskStatisticsStore().recordDiscardedTime(pending.task);
    trashStore.add({
      taskId: pending.taskId,
      task: { ...pending.task, timerId: null },
      deletedAt: Date.now(),
      fromStatus: pending.fromStatus ?? pending.task.status,
      carryOver: pending.carryOver,
    })
  }

  /**
   * A gap whose anchor is a deleted card X hangs on X's gap while it exists. Once X's gap has left the board, every
   * gap that hung on it moves to X's own anchor, so it keeps its place instead of falling to the column end (#438).
   * Done when the gap ends, not when X is deleted: an undo of X then still puts X back before the dependents.
   */
  function reanchorDependents(gone: PendingTaskDelete): void {
    if (!gone.slot) return
    const target = gone.slot.afterId
    for (const other of Object.values(tasksStore.pendingDeletes)) {
      if (other.slot?.afterId === gone.taskId) tasksStore.setPendingDeleteSlot(other.taskId, withAfterId(other.slot, target))
    }
    reanchorClosingGaps(gone.taskId, target)
  }

  /**
   * The window is over: the gap glides shut, the snapshot moves into the trash and the delete commits
   * upstream. A commit that fails for good puts the task back on the board and out of the trash.
   */
  async function closeDelete(taskId: string): Promise<void> {
    const pending = mapHelpers.get(tasksStore.pendingDeletes, taskId)
    if (!pending) return
    if (pending.slot && pending.state === 'waiting') holdClosingGap(pending, reanchorDependents)
    moveToTrash(pending)
    const result = await commitTaskDelete(taskId)
    if (result === 'restored') {
      trashStore.remove(taskId)
      useTaskStatisticsStore().removeDiscardedTime(taskId)
    }
  }

  /** The group a task stacks in on this board (the persisted grouping key), null when it is in no group. */
  function groupKeyOf(task: Task): string | null {
    const by = boardStore.grouping.enabled ? boardStore.grouping.key : null
    return by && shouldTaskBeGrouped(task, by) ? deriveGroupKeyForTask(task, by) : null
  }

  /** A gap by its task id: an open one, else one that glides shut. */
  const gapOf = (gapTaskId: string): PendingTaskDelete | undefined =>
    mapHelpers.get(tasksStore.pendingDeletes, gapTaskId) ?? closingGaps[gapTaskId]

  const columnOf = (pending: PendingTaskDelete): TaskStatus => pending.fromStatus ?? pending.task.status

  /** The gaps of the collapsed stack's group in the column that hang on `base`, in layout order (#502). */
  function stackGapsOn(base: string, status: TaskStatus, groupKey: string): PendingTaskDelete[] {
    const own = Object.values({ ...closingGaps, ...tasksStore.pendingDeletes }).filter(other =>
      other.slot !== undefined && columnOf(other) === status && groupKeyOf(other.task) === groupKey)
    const byId = new Map(own.map(other => [other.taskId, other]))
    return orderGaps(own.map(other => ({ taskId: other.taskId, afterId: other.slot?.afterId, requestedAt: other.requestedAt })))
      .filter(entry => entry.anchor === base)
      .map(entry => byId.get(entry.gap.taskId)!)
  }

  /** The last gap of the stack's chain behind `base`, else `base` itself: where a card at that place hangs its gap (#502). */
  function tailOfStackGaps(base: string, status: TaskStatus, groupKey: string): string {
    return stackGapsOn(base, status, groupKey).at(-1)?.taskId ?? base
  }

  /**
   * A card behind the collapsed stack that was deleted earlier hangs on the same tail (the stack's front task): it
   * moves behind the new gap, so it stays behind the stack's gaps (#502).
   */
  function handOverForeignGaps(taskId: string, tail: string, status: TaskStatus, groupKey: string): void {
    const movable = (other: PendingTaskDelete): boolean =>
      other.taskId !== taskId && other.slot?.afterId === tail && columnOf(other) === status
      && groupKeyOf(other.task) !== groupKey && !chainReaches(taskId, other.taskId)
    for (const other of Object.values(tasksStore.pendingDeletes)) {
      if (other.slot && movable(other)) tasksStore.setPendingDeleteSlot(other.taskId, withAfterId(other.slot, taskId))
    }
    reanchorClosingGaps(tail, taskId, movable)
  }

  /**
   * Whether following `start` through the open and closing gaps (each hangs on its `afterId`) arrives at `targetId`:
   * a gap anchored there would hang on itself, directly or through other gaps (#477). Bounded, so even a cycle that
   * already exists cannot hang the walk.
   */
  function chainReaches(start: string | null | undefined, targetId: string): boolean {
    let current = start
    for (let hops = 0; typeof current === 'string' && hops < 50; hops++) {
      if (current === targetId) return true
      const next = gapOf(current)
      if (!next?.slot) return false
      current = next.slot.afterId
    }
    return false
  }

  /**
   * The last member of an expanded group: nothing a header key resolves to is left (no header, no collapsed stack),
   * so every gap on that header key (the gap of the group's first member that was deleted) moves to the item before
   * the group (#457). It is an ordinary anchor from then on (the lazy re-anchor covers a later delete of that item),
   * and the slot stays exact for an undo: "directly before the lone card" and "behind the item before it" are the
   * same place. The card's own gap keeps the anchor `measureSlot` read (the gap right in front of it, #477), so the
   * gaps stay in card order whatever order the members were deleted in. The item before the group may be a foreign gap
   * (the card in front of the group, the last gap of the previous stack), never one of the group's own.
   * A gap is not moved when the new anchor's chain leads back to it (no cycles).
   */
  function leaveGroupAnchors(task: Task, groupKey: string | null): void {
    if (groupKey === null || !groupHasNoHeaderOrStack(groupKey, task.id)) return
    const headerKey = stackHeaderKey(groupKey)
    const isOwnGap = (gapId: string): boolean => {
      const gap = gapOf(gapId)
      return gap !== undefined && columnOf(gap) === task.status && groupKeyOf(gap.task) === groupKey
    }
    const before = preGroupAnchor(task.id, isOwnGap)
    const movable = (other: PendingTaskDelete): boolean =>
      other.slot?.afterId === headerKey && columnOf(other) === task.status && !chainReaches(before, other.taskId)
    for (const other of Object.values(tasksStore.pendingDeletes)) {
      if (other.slot && movable(other)) tasksStore.setPendingDeleteSlot(other.taskId, withAfterId(other.slot, before))
    }
    reanchorClosingGaps(headerKey, before, movable)
  }

  /**
   * Removes the task, opens its gap and commits upstream once the window has closed. Returns false when the
   * task does not exist. The gap hangs on the item right in front of the card (`measureSlot`), a gap included,
   * and never on itself: an anchor whose chain leads back to the card means the column end (#477).
   */
  function deleteTaskWithUndo(taskId: string, onDeleted?: (taskId: string) => void): boolean {
    const task = tasksStore.task(taskId)
    if (!task) return false

    // A running timer would keep ticking against a removed task.
    stopTaskTimer(taskId)

    // The gap hangs on what stood right in front of the card, a gap included: the chain of gaps is the card order (#477)
    leaveGroupAnchors(task, groupKeyOf(task))
    const measured = measureSlot(taskId)
    // A card of a collapsed stack has no gap sibling to hang on: it hangs behind the stack's own gaps that stand in front of it (#502)
    const stackGroup = collapsedStackGroupKey(taskId)
    const chained = stackGroup !== undefined && stackGroup !== null && typeof measured.afterId === 'string'
      ? withAfterId(measured, tailOfStackGaps(measured.afterId, task.status, stackGroup))
      : measured
    // A card dragged behind a gap that hangs on it would chain the new gap onto itself: the column end instead
    const slot = chainReaches(chained.afterId, taskId) ? withAfterId(measured, undefined) : chained
    const orderIndex = orderIndexOf(taskId, task.status)
    const snapshot = { ...task, timerId: null }
    tasksStore.addPendingDelete({
      taskId,
      task: snapshot,
      carryOver: mapHelpers.get(tasksStore.carryOverByTaskId, taskId) ?? null,
      state: 'waiting',
      requestedAt: Date.now(),
      fromStatus: task.status,
      slot,
      orderIndex,
    })
    tasksStore.removeTask(taskId)
    if (stackGroup !== undefined && stackGroup !== null && typeof slot.afterId === 'string') handOverForeignGaps(taskId, slot.afterId, task.status, stackGroup)
    onDeleted?.(taskId)

    announceStack(translate('trash.announceDeleted', { title: snapshot.title }))
    undoWindow.beginTimed(taskId, DELETE_UNDO_WINDOW_MS, () => { void closeDelete(taskId) })
    return true
  }

  /** The newest delete that is still inside its undo window (#27); undo the one the user just did first. */
  function latestOpenDeleteId(): string | null {
    let latest: PendingTaskDelete | null = null
    for (const pending of Object.values(tasksStore.pendingDeletes)) {
      if (pending.state !== 'waiting' || !undoWindow.isOpen(pending.taskId)) continue
      if (!latest || pending.requestedAt >= latest.requestedAt) latest = pending
    }
    return latest?.taskId ?? null
  }

  /** ⌘Z / Ctrl+Z (#27): undoes the newest delete in its window; false when there is none. */
  function undoLatestDelete(): boolean {
    const taskId = latestOpenDeleteId()
    if (taskId === null) return false
    undoDelete(taskId)
    return true
  }

  /**
   * Closes every pending delete without an open window: deletes left over from a closed app (they enter
   * the trash now) and deletes queued while offline. Call on board start and on reconnect.
   */
  async function resumePendingDeletes(): Promise<void> {
    const ids = mapHelpers.keys(tasksStore.pendingDeletes).filter(id => !undoWindow.isOpen(id))
    for (const id of ids) {
      await closeDelete(id)
    }
  }

  return {
    deleteTaskWithUndo,
    resumePendingDeletes,
    undoDelete,
    undoLatestDelete,
    pauseDelete: undoWindow.pause,
    resumeDelete: undoWindow.resume,
  }
}

/** Test helper: forgets open undo windows between tests. */
export function resetTaskDeletionState(): void {
  resetUndoWindows()
  resetDeleteGapState()
}
