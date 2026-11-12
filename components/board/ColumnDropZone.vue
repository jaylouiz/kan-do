<!--
@component ColumnDropZone
@kind primitive
@category layout
@description Invisible droppable sentinel for each board column.
Ensures @dnd-kit/vue can accept drops even when a column has no sortable items.
Uses useDroppable with data.taskStatus so useBoardDndKit.onDragEnd can identify
the target column for cross-column transfers.

Ghost placeholder visibility:
- Empty columns: isDropTarget becomes true when ColumnDropZone wins collision
  (collisionPriority: 0 guarantees sortables always win on non-empty columns)
- Non-empty columns: dnd-kit's sortable handles insertion preview via .kando-dnd-dragged
  moving physically to the destination — no ghost needed here
- A column whose only card (or stack) is the one being dragged counts as empty once dnd-kit moved that
  node into another column (#372): it is judged by its list's DOM, not by the store, which still holds
  the task. The ghost shows there; the node stays in the other column, its slot made transparent by the
  same `:has(.column-drop-zone__ghost)` rule as for any empty target (taken out of the layout when other
  cards remain there, so they leave no gap, #393). The DOM answer is re-read whenever
  the list's children change during a drag (dnd-kit moves the node after the zone became the target)
- A refused drop (the WIP limit, or any stack into Jetzt, #150) shows no ghost: the slot would promise a landing
@usage Rendered once per BoardColumn so an empty column still accepts a drop
@avoid Invisible; never a visible drop target and never outside a board column (the sortable cards are the visible targets).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDroppable } from '@dnd-kit/vue'
import type { TaskStatus } from '~/types/taskStatus'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { listHasItemNode } from '~/utils/columnItems'

defineOptions({ name: 'ColumnDropZone' })

const props = defineProps<{
  /** Column status this drop zone belongs to */
  taskStatus: TaskStatus
  /** Whether the column has no tasks; kept for consistency with BoardColumn usage */
  isEmpty: boolean
}>()

const element = ref<HTMLElement | null>(null)

const { isDropTarget } = useDroppable({
  id: `column-drop-zone-${props.taskStatus}`,
  element,
  data: { taskStatus: props.taskStatus },
  collisionPriority: 0,
})

const { dragState } = useBoardDragState()

/**
 * Whether the column's list holds no card or stack node right now. A DOM fact, so it is refreshed by
 * hand: when the zone becomes the drop target and, during a drag, whenever the list's children change
 * (dnd-kit moves the dragged node in or out of the list after the zone already won the collision).
 */
const listIsEmpty = ref(false)
const list = () => element.value?.parentElement ?? null
const measureList = () => {
  listIsEmpty.value = !listHasItemNode(list())
}

let observer: MutationObserver | null = null
const stopObserving = () => {
  observer?.disconnect()
  observer = null
}
const startObserving = () => {
  stopObserving()
  const target = list()
  if (!target || typeof MutationObserver === 'undefined') return
  observer = new MutationObserver(measureList)
  observer.observe(target, { childList: true })
  measureList()
}

// A drag starts long after mount, so the zone's element and its list exist when this fires
watch(() => dragState.value.isDragging, (dragging) => {
  if (dragging) startObserving()
  else stopObserving()
})
watch(isDropTarget, (isTarget) => {
  if (isTarget) measureList()
})
onBeforeUnmount(stopObserving)

// Only show ghost on empty columns — once a task lands, isEmpty becomes false
// immediately, preventing a one-frame flash where both card and ghost are visible.
const showGhost = computed(() =>
  isDropTarget.value && (props.isEmpty || listIsEmpty.value) && !dragState.value.isDropBlocked)
</script>

<template>
  <div
    ref="element"
    class="column-drop-zone"
    :data-drop-zone-status="taskStatus"
    aria-hidden="true"
  >
    <div v-if="showGhost" class="column-drop-zone__ghost" />
  </div>
</template>

<style scoped>
.column-drop-zone {
  /* Invisible sentinel; fills remaining space so pointer can land on it */
  flex: 1;
  min-height: 80px;
  pointer-events: auto;
}

.column-drop-zone__ghost {
  height: var(--task-card-height);
  width: min(var(--task-card-width), 100%);
  /* Shrinks on narrow columns (mobile) without overflowing; capped like the dropped card (#234) */
  max-width: min(var(--task-card-max-width), 100%);
  margin: 0 auto;
  background-color: var(--dnd-slot-bg);
  border-radius: var(--task-card-radius);
}

@media (--phone) {
  .column-drop-zone__ghost {
    height: 8rem;
  }
}
</style>
