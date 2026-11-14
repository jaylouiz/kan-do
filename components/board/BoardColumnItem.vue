<!--
@component BoardColumnItem
@kind compound
@category layout
@description One element of a standard column's task list: a collapsed stack, the header row of an expanded one, or a sortable card
@usage Rendered by BoardColumn, one per list item
@avoid Not for the Jetzt column (BoardColumnProgressContent) and not for a card outside a column list; use TaskCard directly for a static card.
@responsibility
- Renders the capacity divider (#132) as BoardCapacityDivider: not a sortable, no drag, no drop, like a gap
- Renders the slot of a card deleted inside its undo window as TaskDeletedGap (#422): not a sortable, no drag, no drop
- Renders a collapsed group as TaskStack (one sortable by its front task, #150), the header row of an expanded one as TaskStackHeader (not a
  sortable: it sits next to the sortables, never inside one), anything else as SortableTaskWrapper >
  context menu > TaskCard (the same markup for an ungrouped card, a single-card group and a member of
  an expanded stack)
- Has exactly one root element per item (no fragment). dnd-kit moves the dragged wrapper next to its
  target and Vue removes a fragment by walking its anchors: a card that sat in another card's
  fragment would be removed with it (#146). One root node per item keeps the list flat.
-->
<template>
  <board-capacity-divider v-if="item.kind === 'capacity'" />
  <task-deleted-gap v-else-if="item.kind === 'gap'" :gap="item.gap" />
  <task-stack
    v-else-if="item.kind === 'stack'"
    :stack-key="item.groupKey"
    :label="item.label"
    :tasks="item.tasks"
    :muted="item.muted"
    :task-status="taskStatus"
    :sortable-index="item.sortableIndex"
    :style="{ '--item-index': item.itemIndex }"
    @expand="onExpand"
  />
  <task-stack-header
    v-else-if="item.kind === 'stack-header'"
    :group-key="item.groupKey"
    :label="item.label"
    :count="item.count"
    :first-task="item.firstTask"
    @close="onClose"
  />
  <sortable-task-wrapper
    v-else
    :task-id="item.task.id"
    :index="item.sortableIndex"
    :task-status="taskStatus"
    :from-stack="item.fromStack"
    :stack-position="item.stackPosition"
    :stack-index="item.stackIndex"
    :stack-size="item.stackSize"
    :stack-label="item.stackLabel"
  >
    <task-card-context-menu v-if="!staticMode" :task="item.task">
      <task-card
        :task="item.task"
        :muted="item.muted"
        :style="{ '--item-index': item.itemIndex }"
        @open="(id) => emit('open', id)"
      />
    </task-card-context-menu>
    <task-card
      v-else
      :task="item.task"
      :muted="item.muted"
      :style="{ '--item-index': item.itemIndex }"
    />
  </sortable-task-wrapper>
</template>

<script setup lang="ts">
import TaskCard from "~/components/task/TaskCard.vue";
import TaskCardContextMenu from "~/components/task/TaskCardContextMenu.vue";
import BoardCapacityDivider from "~/components/board/BoardCapacityDivider.vue";
import TaskDeletedGap from "~/components/task/TaskDeletedGap.vue";
import TaskStack from "~/components/task/TaskStack.vue";
import TaskStackHeader from "~/components/task/TaskStackHeader.vue";
import SortableTaskWrapper from "~/components/board/SortableTaskWrapper.vue";
import type { ColumnItem } from "~/types/columnItem";
import type { TaskStatus } from "~/types/taskStatus";

defineOptions({ name: "BoardColumnItem" });

const props = defineProps<{
  item: ColumnItem;
  taskStatus: TaskStatus;
  /** Static boards (no navigation, no context menu) */
  staticMode: boolean;
}>();

const emit = defineEmits<{
  /** A card passed TaskCard's guards; the column owns navigation */
  open: [id: string];
  /** A collapsed stack asks to expand; `source` tells where focus should go */
  expand: [groupKey: string, source: "pointer" | "keyboard", event?: MouseEvent];
  /** "Schließen" in an expanded group's header row */
  closeStack: [groupKey: string, source: "pointer" | "keyboard"];
}>();

function onClose(source: "pointer" | "keyboard") {
  if (props.item.kind === "stack-header") emit("closeStack", props.item.groupKey, source);
}

function onExpand(source: "pointer" | "keyboard", event?: MouseEvent) {
  if (props.item.kind === "stack") emit("expand", props.item.groupKey, source, event);
}
</script>
