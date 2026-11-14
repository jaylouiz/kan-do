import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useBoardDragState, type DraggedStack } from '~/composables/useBoardDragState'
import { useTaskSync } from '~/composables/useTaskSync'
import { useCompletionUndo } from '~/composables/useCompletionUndo'
import { TaskStatus } from '~/types/taskStatus'
import { finishedFasterThanPlan } from '~/lib/completionPace'
import { canSwapIntoProgress, checkWipMove } from '~/utils/wipGuard'
import { useTaskSwap } from '~/composables/useTaskSwap'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { deriveGroupKeyForTask, getRenderedTaskOrder, isGroupingActiveFor, shouldTaskBeGrouped } from '~/utils/taskGrouping'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { isSortable } from '@dnd-kit/vue/sortable'
import { isColumnItemNode } from '~/utils/columnItems'

/**
 * Central dnd-kit event handler for the board.
 * Wired into DragDropProvider on Board.vue.
 *
 * Responsibilities:
 * - Update global drag state (isDragging, draggedTaskId, draggedStack)
 * - On dragEnd: persist reorder to the board store; route cross-column transfers through
 *   `useTaskSync().updateTaskStatus` (completedAt, statistics, upstream sync)
 * - Enforce WIP limit on Progress column via dragOver prevention; a single card from Offen or Wartet over
 *   a Jetzt that holds one task is not refused but marks that card as the swap target (`swapTaskId`, #162),
 *   and the drop swaps through `useTaskSwap`
 * - Flag a card dropped into Erledigt for the in-card done confirmation (#124); reduced motion
 *   hides the layer in CSS (TaskCard), so the flag is set either way. No completion toast on this
 *   path (#136): the card and the drop announcement confirm it, undo is the reverse drag
 * - A collapsed stack is one sortable (id = its front task, data.stack = key, label, taskIds, #150).
 *   Dropping it moves every member as one block: members are snapshotted at drag start, a block of
 *   2+ never fits Jetzt, and a block completed in Erledigt gets ONE undo toast (the deliberate
 *   exception to #136: after a merge the reverse drag would also move tasks done before)
 */

export function useBoardDndKit() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { dragState } = useBoardDragState()
  const { updateTaskStatus, updateTaskStatuses, handleSyncError } = useTaskSync()
  const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
  const { swapIntoProgress } = useTaskSwap()
  const stacks = useStackExpansion()
  const { effectiveGroupKey } = useBoardGrouping()
  const { applyFocus } = useBoardFocus()

  function getTasksByStatus(status: TaskStatus) {
    switch (status) {
      case TaskStatus.Open: return tasksStore.tasksOpen
      case TaskStatus.Progress: return tasksStore.tasksProgress
      case TaskStatus.Waiting: return tasksStore.tasksWaiting
      case TaskStatus.Done: return tasksStore.tasksDone
      default: return []
    }
  }

  /**
   * The tasks a column renders. Erledigt shows only today's tasks (earlier days sit in the Gestern
   * note, archived ones nowhere), so its indices refer to `tasksDoneToday`, not to every done task.
   * A topic focus (#161) hides further cards the same way: the drop slot maps against what is rendered, and the
   * hidden cards keep their relative order behind the rendered ones when a column is saved.
   */
  function getRenderedTasks(status: TaskStatus) {
    return applyFocus(status === TaskStatus.Done ? tasksStore.tasksDoneToday : getTasksByStatus(status))
  }

  /** The group key a column renders with, or null when it is not grouped (#135). */
  function getColumnGroupKey(status: TaskStatus) {
    const { enabled } = boardStore.grouping
    const key = effectiveGroupKey.value
    return isGroupingActiveFor(status, enabled, key) ? key : null
  }

  /** A column's rendered order and draggable cards, with the stacks the user has expanded (#147) */
  function getRenderedOrder(status: TaskStatus) {
    return getRenderedTaskOrder(getRenderedTasks(status), getColumnGroupKey(status), stacks.expandedKeys(status))
  }

  /**
   * The dragged card at drag start. dnd-kit moves its DOM node to preview the slot and puts it back
   * only on a canceled drag, and then only next to a sibling, so onDragEnd restores it from data (restoreDraggedElement): Vue then
   * renders the saved order from a DOM it knows, including a drop that grouping snaps back (#135).
   */
  type DragOrigin = {
    element: Element
    list: Element | null
    taskId: string
    status: TaskStatus | undefined
  }
  let dragOrigin: DragOrigin | null = null
  /** The stack picked up at drag start (#150): the members it moves are the ones it had then */
  let dragStack: DraggedStack | null = null

  /**
   * The droppables of the running drag, for `refreshDroppableShapes`. dnd-kit's manager is private
   * API, so every member is optional: a version without one of them turns the refresh into a no-op.
   */
  type DragManager = { registry?: { droppables?: Iterable<{ element?: Element | undefined; refreshShape?: () => unknown }> } }
  let dragManager: DragManager | null = null
  let droppableRefreshFrame: number | null = null

  function cancelDroppableRefresh() {
    if (droppableRefreshFrame === null) return
    cancelAnimationFrame(droppableRefreshFrame)
    droppableRefreshFrame = null
  }

  /**
   * Re-measures the droppables on the visible page after the mobile board switched pages mid-drag
   * (#372). dnd-kit drops the shape of a droppable that scrolls out of view but keeps its last rect
   * and only measures again when the rect changed, so a droppable that comes back in the same place
   * (Jetzt's drop zone once its card was pulled out, a card nothing moved) has no shape and can
   * never be hovered again: the drag finds no target there. Droppables still off-screen keep none.
   * Runs two frames later, when the switch has been laid out and dnd-kit's own visibility pass is done.
   * The frames are cancelled when the drag ends, and a missing private member skips the refresh
   * instead of throwing inside the frame callback.
   */
  function refreshDroppableShapes() {
    cancelDroppableRefresh()
    droppableRefreshFrame = requestAnimationFrame(() => {
      droppableRefreshFrame = requestAnimationFrame(() => {
        droppableRefreshFrame = null
        try {
          for (const droppable of dragManager?.registry?.droppables ?? []) {
            const rect = droppable.element?.getBoundingClientRect()
            if (rect && rect.right > 0 && rect.left < window.innerWidth) droppable.refreshShape?.()
          }
        } catch (error) {
          if (import.meta.dev) console.warn('[DnD] could not refresh the droppable shapes', error)
        }
      })
    })
  }

  /** The stack a sortable carries as data (`useColumnSortable`'s `data`), copied; null for a card */
  function readStack(source: unknown): DraggedStack | null {
    const stack = (source as { data?: { stack?: DraggedStack } } | null)?.data?.stack
    return stack ? { key: stack.key, label: stack.label, taskIds: [...stack.taskIds] } : null
  }

  const listItems = (list: Element, except: Element) =>
    [...list.children].filter(child => child !== except && child.hasAttribute('data-task-id'))

  /**
   * Puts the dragged node back where the column renders its task, or removes it when it renders
   * none (#146). The decision comes from the store, not from remembered siblings: a sync mid-drag
   * can unmount the fragment of a neighbouring card, and dnd-kit may have moved the node into that
   * fragment, so Vue removed it along with the fragment (it must come back) or the task no longer
   * renders as a draggable card at all (the node is a leftover and would show as a ghost until a
   * reload).
   * - the column still renders the task as a draggable card or as the front of a collapsed stack: place the node before the element of
   *   the next rendered item that exists, else after the last item, else before the drop zone (the add slot sits at the
   *   start of an Offen list, #248, so a node must land after its draft, never before it). If Vue already rendered a fresh wrapper for the task, the old node is the leftover.
   * - otherwise: remove the node if it is still in the document.
   */
  function restoreDraggedElement(origin: DragOrigin | null) {
    if (!origin) return
    const { element, list, taskId, status } = origin
    const order = status === undefined ? null : getRenderedOrder(status)
    if (!order || !list || !order.draggableIds.includes(taskId)) {
      if (element.isConnected) element.remove()
      return
    }

    const siblings = listItems(list, element)
    if (siblings.some(el => isColumnItemNode(el) && el.getAttribute('data-task-id') === taskId)) {
      if (element.isConnected) element.remove()
      return
    }

    const ids = order.rendered.map(t => t.id)
    const laterIds = ids.slice(ids.indexOf(taskId) + 1)
    const next = laterIds.map(id => siblings.find(el => el.getAttribute('data-task-id') === id)).find(Boolean) ?? null
    if (next) {
      if (element.parentNode === list && element.nextElementSibling === next) return
      list.insertBefore(element, next)
      return
    }
    const last = siblings[siblings.length - 1]
    if (last) {
      if (element.parentNode === list && element.previousElementSibling === last) return
      list.insertBefore(element, last.nextSibling)
      return
    }
    list.insertBefore(element, list.querySelector(':scope > .column-drop-zone'))
  }

  /**
   * The slot dnd-kit previews the card in: the id of the next card or stack in the `status` list
   * (a stack by its first task), null at the end. Undefined when the node is not in that list
   * (a drop-zone drop leaves it in the last column it was sorted into).
   */
  function readNextItemId(element: Element | undefined, status: TaskStatus): string | null | undefined {
    if (element?.parentElement?.getAttribute('data-task-status') !== String(status)) return undefined
    for (let el = element.nextElementSibling; el; el = el.nextElementSibling) {
      if (isColumnItemNode(el)) return el.getAttribute('data-task-id')
    }
    return null
  }

  /**
   * Moves `taskIds` (one card, or the members of a stack in their order) to the dropped slot and
   * saves the column order. The slot is the one dnd-kit previews: before `nextId`, the card or stack
   * that follows the dragged node (#135). Without a readable DOM, dnd-kit's `index` is mapped
   * against the draggable list (a collapsed stack counts once, by its front task): after the
   * draggable at `index - 1` for a downward move (dnd-kit inserts `afterend`), else before the one
   * at `index`. Grouping then decides the section, and the saved order is the resulting rendered
   * order. A drop that leaves it unchanged saves nothing, so the column sorting does not switch to
   * manual. Tasks the column does not render keep their relative order behind the rendered ones.
   * The members of an expanded stack are draggable too (#147), so the draggable list follows the
   * column's expanded groups. A member dropped outside its own group's span within the column
   * changes nothing: grouping decides the order, it does not switch to a manual one. A whole stack
   * leaves no group behind, so it can be placed among the groups, but a drop above the ungrouped
   * tasks snaps back; dropped next to a group of its own
   * key it merges with it (grouping keeps same-key tasks together, the earlier task fronts the stack).
   */
  function saveRenderedOrder(
    status: TaskStatus,
    taskIds: readonly string[],
    slot: { nextId: string | null | undefined; index: number; downward: boolean; sameColumn?: boolean },
  ) {
    const tasks = getRenderedTasks(status)
    const moving = taskIds.flatMap(id => tasks.find(t => t.id === id) ?? [])
    const first = moving[0]
    if (!first) return
    const movingIds = new Set(moving.map(t => t.id))
    const groupKey = getColumnGroupKey(status)
    const expanded = stacks.expandedKeys(status)
    const before = getRenderedTaskOrder(tasks, groupKey, expanded).rendered.map(t => t.id)

    const { rendered, draggableIds } = getRenderedTaskOrder(tasks.filter(t => !movingIds.has(t.id)), groupKey, expanded)
    const indexOf = (id: string | undefined) => rendered.findIndex(t => t.id === id)
    // The last rendered task of a draggable item: for a collapsed stack (listed by its front task)
    // its last member, so a slot "after" a stack is behind all of it
    const endOf = (id: string | undefined) => {
      const start = indexOf(id)
      const task = rendered[start]
      if (start === -1 || !task || groupKey === null || !shouldTaskBeGrouped(task, groupKey)) return start
      const key = deriveGroupKeyForTask(task, groupKey)
      if (expanded.includes(key)) return start
      let end = start
      for (let t = rendered[end + 1]; t && shouldTaskBeGrouped(t, groupKey) && deriveGroupKeyForTask(t, groupKey) === key; t = rendered[end + 1]) end++
      return end
    }
    let at = slot.nextId === null ? rendered.length : indexOf(slot.nextId)
    if (at === -1) {
      const index = Math.min(Math.max(slot.index, 0), draggableIds.length)
      const next = indexOf(draggableIds[index])
      const prev = endOf(draggableIds[index - 1])
      at = slot.downward
        ? prev !== -1 ? prev + 1 : next !== -1 ? next : rendered.length
        : next !== -1 ? next : prev !== -1 ? prev + 1 : rendered.length
    }

    if (slot.sameColumn && groupKey !== null && shouldTaskBeGrouped(first, groupKey)) {
      const own = deriveGroupKeyForTask(first, groupKey)
      const mates = rendered.flatMap((t, i) =>
        shouldTaskBeGrouped(t, groupKey) && deriveGroupKeyForTask(t, groupKey) === own ? [i] : [])
      // The group's span: from its first member to the slot below its last one
      if (mates.length > 0 && (at < Math.min(...mates) || at > Math.max(...mates) + 1)) return
    }
    // A whole stack asked for a place among the ungrouped tasks (which render first): grouping
    // would put it somewhere else, so it snaps back instead (#150, "Same column")
    if (slot.sameColumn && groupKey !== null && moving.every(t => shouldTaskBeGrouped(t, groupKey))) {
      const lastUngrouped = rendered.findLastIndex(t => !shouldTaskBeGrouped(t, groupKey))
      if (at <= lastUngrouped) return
    }
    rendered.splice(at, 0, ...moving)

    const after = getRenderedTaskOrder(rendered, groupKey, expanded).rendered.map(t => t.id)
    if (after.every((id, i) => id === before[i])) return
    const renderedIds = new Set(after)
    const hidden = getTasksByStatus(status).map(t => t.id).filter(id => !renderedIds.has(id))
    boardStore.saveTaskOrder({ taskStatus: status, taskOrder: [...after, ...hidden] })
  }

  function onDragStart(event: {
    operation: { source: { id: string | number; group?: unknown; element?: Element | undefined } | null }
  }) {
    const { source } = event.operation
    if (!source) return
    const element = source.element
    const taskId = String(source.id)
    boardStore.endTimeboxNudge(taskId) // a drag ends the card's nudge (#389)
    dragOrigin = element ? { element, list: element.parentElement, taskId, status: source.group as TaskStatus | undefined } : null
    dragStack = readStack(source)
    dragManager = (source as { manager?: DragManager }).manager ?? null
    dragState.value.isDragging = true
    dragState.value.draggedTaskId = taskId
    dragState.value.draggedStack = dragStack ? { ...dragStack, taskIds: [...dragStack.taskIds] } : null
    dragState.value.sourceStatus = (source.group as TaskStatus) ?? null
    dragState.value.hoverTargetStatus = null
    dragState.value.isDropBlocked = false
    dragState.value.swapTaskId = null
  }

  function onDragOver(event: { operation: { source: unknown; target: unknown }; preventDefault: () => void }) {
    const source = event.operation.source
    const target = event.operation.target

    // The swap state (#162) lasts only while the pointer is over Jetzt: no target at all ends it too
    if (!target) dragState.value.swapTaskId = null
    if (!isSortable(source as never) || !target) return

    // Resolve target column status from sortable group or ColumnDropZone data
    let targetGroup: TaskStatus | undefined
    if (isSortable(target as never)) {
      targetGroup = (target as { group: unknown }).group as TaskStatus | undefined
    } else {
      // Plain droppable (ColumnDropZone) — read taskStatus from data
      const targetData = (target as { data?: { taskStatus?: TaskStatus } }).data
      targetGroup = targetData?.taskStatus
    }

    dragState.value.hoverTargetStatus = targetGroup ?? null

    // Reset drop-blocked when not hovering Progress
    if (targetGroup !== TaskStatus.Progress) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      return
    }

    // WIP limit: Progress column accepts at most 1 task. The column the drag started in decides,
    // not the sortable's `group`: that follows the card into every column it was sorted into, so a
    // Jetzt card pulled out over Offen and back would read as an Offen card entering a full Jetzt (#372)
    const { initialGroup, group } = source as { initialGroup?: unknown; group?: unknown }
    const sourceGroup = (initialGroup ?? group) as TaskStatus | undefined
    if (sourceGroup === TaskStatus.Progress) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      return // reorder within progress is fine
    }

    // A single card over a Jetzt that holds one other task swaps instead of being refused (#162): the
    // running card shows the swap state, the drop is decided in onDragEnd. The card still must not move
    // into Jetzt, so the drag-over stays prevented.
    const dragged = dragStack ?? readStack(source)
    if (canSwapIntoProgress({
      incomingStatus: (sourceGroup ?? TaskStatus.Open) as TaskStatus,
      progressCount: tasksStore.tasksProgress.length,
      taskCount: dragged?.taskIds.length ?? 1,
    })) {
      dragState.value.swapTaskId = tasksStore.tasksProgress[0]?.id ?? null
      dragState.value.isDropBlocked = false
      event.preventDefault()
      return
    }
    dragState.value.swapTaskId = null

    const verdict = checkWipMove({
      currentStatus: (sourceGroup ?? TaskStatus.Open) as TaskStatus,
      targetStatus: TaskStatus.Progress,
      progressCount: tasksStore.tasksProgress.length,
      taskCount: (dragStack ?? readStack(source))?.taskIds.length ?? 1,
    })
    if (!verdict.allowed) {
      dragState.value.isDropBlocked = true
      event.preventDefault()
    } else {
      dragState.value.isDropBlocked = false
    }
  }

  function onDragEnd(event: { canceled: boolean; operation: { source: unknown; target: unknown } }) {
    const swapOnDrop = Boolean(dragState.value.swapTaskId) && !event.canceled
    dragState.value.swapTaskId = null
    dragState.value.isDragging = false
    dragState.value.draggedTaskId = null
    dragState.value.draggedStack = null
    dragState.value.sourceStatus = null
    dragState.value.hoverTargetStatus = null
    dragState.value.isDropBlocked = false

    const origin = dragOrigin
    dragOrigin = null
    const stack = dragStack
    dragStack = null
    dragManager = null
    cancelDroppableRefresh()

    // A canceled drag: dnd-kit reverts the node only relative to a sibling in the origin list, so the
    // sole card of a column (Jetzt holds one) would stay in the column it was sorted into (#424)
    if (event.canceled) {
      restoreDraggedElement(origin)
      return
    }

    const { source, target } = event.operation
    if (!isSortable(source as never)) return

    const sortable = source as {
      id: string | number
      initialIndex: number
      index: number
      initialGroup: unknown
      group: unknown
      element?: Element | undefined
      data?: unknown
    }

    const { id, initialIndex, index, initialGroup, group } = sortable
    const srcStatus = initialGroup as TaskStatus | undefined

    // Determine target status. A ColumnDropZone target (plain droppable with data.taskStatus) is
    // authoritative: the sortable `group` only follows sortable-to-sortable moves, so after the
    // pointer crossed another column it would still name that intermediate column (the empty area
    // under a short Erledigt list would then drop the card into e.g. Wartet).
    let tgtStatus = group as TaskStatus | undefined
    if (target && !isSortable(target as never)) {
      const targetData = (target as { data?: { taskStatus?: TaskStatus } }).data
      if (targetData?.taskStatus !== undefined) {
        tgtStatus = targetData.taskStatus
      }
    }

    // Read the previewed slot, then put the node back: whatever the store update below does (or
    // a drop that changes nothing), Vue renders it from the DOM it knows
    const nextId = tgtStatus === undefined ? undefined : readNextItemId(sortable.element, tgtStatus)
    restoreDraggedElement(origin)

    if (srcStatus === undefined || tgtStatus === undefined) return

    // The members this drop moves: the stack as it was at drag start (else as the sortable carries it
    // now), minus those that no longer exist or left the source column meanwhile. A single card is
    // just itself. Nothing left: nothing to do.
    const block = stack ?? readStack(sortable)
    const ids = block
      ? block.taskIds.filter(taskId => tasksStore.task(taskId)?.status === srcStatus)
      : [String(id)]
    if (ids.length === 0) return

    // Dropped on the running card (#162): swap. The store decides again at the drop (Jetzt may have
    // emptied or changed meanwhile); when it no longer swaps, the drop goes on as an ordinary move.
    if (swapOnDrop && srcStatus !== TaskStatus.Progress && !block && swapIntoProgress(ids[0]!)) {
      if (import.meta.dev) console.log('[DnD] swap', { taskId: ids[0], from: srcStatus })
      return
    }

    // WIP limit is enforced in onDragOver, but the target resolved above can differ from the last
    // hover (drop-zone override, stale group). Re-check so Jetzt never ends up with two tasks. A
    // stack never fits, whatever Jetzt holds, so the check counts the whole stack as it was picked up.
    if (srcStatus !== tgtStatus) {
      const verdict = checkWipMove({
        currentStatus: srcStatus,
        targetStatus: tgtStatus,
        progressCount: tasksStore.tasksProgress.length,
        taskCount: block?.taskIds.length ?? 1,
      })
      if (!verdict.allowed) return
    }

    if (srcStatus === tgtStatus) {
      // Same-column reorder
      if (initialIndex === index) return

      saveRenderedOrder(srcStatus, ids, { nextId, index, downward: index > initialIndex, sameColumn: true })

      if (import.meta.dev) {
        console.log('[DnD] reorder', { taskIds: ids, srcStatus, from: initialIndex, to: index })
      }
    } else {
      // Cross-column transfer
      // Shared status-change path: applies status, completedAt and statistics synchronously
      // (still inside onDragEnd), then syncs upstream. Sync errors are handled inside. A stack moves
      // every member locally at once and writes upstream one member after another.
      const completing = tgtStatus === TaskStatus.Done && block !== null
      const snapshots = completing ? captureCompletionSnapshots(ids) : []
      // Per-write failures are handled inside; the catch is for anything that escapes the chain
      const reportFailure = (error: unknown) => handleSyncError(error, `Failed to move ${ids.join(', ')} to ${tgtStatus}`)
      if (block) {
        updateTaskStatuses(ids, tgtStatus).catch(reportFailure)
      } else {
        updateTaskStatus({ taskId: ids[0]!, status: tgtStatus }).catch(reportFailure)
      }

      // Place the card (or the block) at the dropped index in the target column (the status change
      // above has already put it into that column's list)
      saveRenderedOrder(tgtStatus, ids, { nextId, index, downward: false })

      // Timebox nudge (#389): a timebox-less card dropped into Jetzt asks for one (a block never fits in Jetzt)
      if (tgtStatus === TaskStatus.Progress) boardStore.startTimeboxNudge(ids[0]!)

      // In-card done confirmation (#124): every dropped card. A stack gets one undo toast for all
      // of them (#150)
      if (tgtStatus === TaskStatus.Done) {
        ids.forEach(taskId => boardStore.startConfirmation(taskId, finishedFasterThanPlan(tasksStore.task(taskId))))
        if (completing) notifyCompletedBlock(snapshots)
      }

      if (import.meta.dev) {
        console.log('[DnD] transfer', { taskIds: ids, from: srcStatus, to: tgtStatus, atIndex: index })
      }
    }
  }

  return {
    onDragStart,
    onDragOver,
    onDragEnd,
    refreshDroppableShapes,
  }
}
