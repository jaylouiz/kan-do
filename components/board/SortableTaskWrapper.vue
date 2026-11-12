<!--
@component SortableTaskWrapper
@kind component
@category layout
@description Per-item sortable wrapper for dnd-kit. Each task card in a column
is wrapped in this component so it can be dragged and sorted within/across columns.
@usage Wraps every task card of a sortable column (BoardColumnItem)
@avoid Only for task cards in a sortable column; static lists (trash, recap, day close) render the card without it.
@responsibility
- Register with dnd-kit's DragDropManager via useColumnSortable
- Expose isDragging state for placeholder styling
- Name the card for assistive tech: role=group + aria-label = task title + localised role description.
  Not role=button: axe's label-content-name-mismatch (WCAG 2.5.3) would demand the whole visible card text in the name.
- Enter on the focused card opens the task details (Space starts the keyboard drag); a held key's repeats do not
- Delete or Backspace on the focused card deletes it with undo (#579): the shared deleteTaskWithUndo, focus on the
  neighbour card. Ignored for a held key, a modifier, a drag in progress and keys that bubble from a control inside the card
- Preserve data-task-id attribute for E2E tests and CSS targeting
- Describe a member of an expanded stack for assistive tech: a visually hidden "n of m in <group>"
  wired by aria-describedby (#154). The accessible name stays the task title.
- Mark a member of an expanded stack with data-from-stack="<group key>" (#147): a click on it is not
  an outside click for the column's expanded stacks
-->
<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { useColumnSortable } from '~/composables/useColumnSortable'
import { useDropMotionClasses } from '~/composables/useDropMotion'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { findCardElement, neighbourCardId } from '~/utils/neighbourCard'
import { focusFirstAvailable } from '~/utils/focusRecovery'
import type { TaskStatus } from '~/types/taskStatus'

defineOptions({ name: 'SortableTaskWrapper' })

const props = defineProps<{
  taskId: string
  index: number
  taskStatus: TaskStatus
  /** Group key of the expanded stack this card belongs to */
  fromStack?: string
  /** Place in that stack; the spacing of the expanded group keys on it, not on DOM neighbours */
  stackPosition?: 'first' | 'middle' | 'last'
  /** 1-based place in that stack; with `stackSize` and `stackLabel` it forms the member description */
  stackIndex?: number
  /** Number of cards in the stack */
  stackSize?: number
  /** Readable group name */
  stackLabel?: string
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()
const task = computed(() => tasksStore.tasks.find(item => item.id === props.taskId))
const element = ref<HTMLElement | null>(null)
const indexRef = computed(() => props.index)

const positionId = `task-wrapper-position-${useId()}`
const positionText = computed(() =>
  props.stackIndex !== undefined && props.stackSize !== undefined && props.stackLabel !== undefined
    ? t('board.stack.memberPosition', { n: props.stackIndex, total: props.stackSize, group: props.stackLabel })
    : null,
)

const dropMotionClasses = useDropMotionClasses(() => props.taskId)

const { isDragging } = useColumnSortable(
  props.taskId,
  indexRef,
  props.taskStatus,
  element
)

/**
 * Enter opens details. dnd-kit's keyboard sensor only starts on Space (see useBoardAnnouncements),
 * so Enter reaches us. Dispatches a click (detail 0) on the card, so TaskCard's open handler keeps the stack/drag
 * guards in one place. It does not bubble: the board's outside-click listeners must not take a key press for a pointer click.
 */
function openDetails(event: KeyboardEvent) {
  // A held Enter repeats: the one that expanded a stack lands here on its first member, and a
  // repeat must not open the sheet
  if (event.repeat) return
  event.preventDefault()
  element.value?.querySelector<HTMLElement>('.task')?.dispatchEvent(new MouseEvent('click'))
}

const { deleteTaskWithUndo } = useTaskDeletion()

/**
 * Delete (and Backspace, the Mac "delete" key) deletes the focused card (#579). `.self` on the listener keeps a key
 * pressed in a control inside the card out. A held key would delete the neighbour focus just moved to, so repeats are
 * ignored; so are modifier combos and a running keyboard drag.
 */
function deleteFocusedCard(event: KeyboardEvent) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isDragging.value) return
  event.preventDefault()
  // Resolved before the delete: afterwards the card's own gap stands in its place
  const neighbour = neighbourCardId(props.taskId)
  if (!deleteTaskWithUndo(props.taskId)) return
  // No neighbour: the gap moves the lost focus on when its window closes
  if (neighbour) {
    focusFirstAvailable([() => findCardElement(neighbour)])
  }
}
</script>

<template>
  <div
    ref="element"
    class="task-wrapper"
    :data-task-id="taskId"
    :data-from-stack="fromStack"
    :data-stack-position="stackPosition"
    role="group"
    :aria-label="task?.title"
    :aria-describedby="positionText ? positionId : undefined"
    :aria-roledescription="t('board.dnd.roleDescription')"
    :class="[{ 'kando-dnd-dragged': isDragging }, dropMotionClasses]"
    @keydown.enter.self="openDetails"
    @keydown.delete.self="deleteFocusedCard"
  >
    <slot />
    <span v-if="positionText" :id="positionId" hidden>{{ positionText }}</span>
  </div>
</template>
