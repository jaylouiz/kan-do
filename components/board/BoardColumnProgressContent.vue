<!--
@component BoardColumnProgressContent
@kind compound
@category layout
@description Specialized content for the Progress column
@usage Rendered by BoardColumn for the Jetzt column only
@avoid Only for the Jetzt column; the other columns render lists through BoardColumnItem.
@responsibility
- Renders the task list for "In Progress" tasks
- Displays the dedicated progress bar for the active task
- Hosts the add-and-start slot while Jetzt is empty (#125); it morphs into the Jetzt draft card
- Manages specific layout requirements for the progress column
-->
<template>
  <div class="progress-column-content-wrapper">
    <div
      :id="listId"
      ref="listEl"
      :data-task-status="TaskStatus.Progress"
      class="task-list overflow-visible px-3 text-center md:px-10"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
      @focusin="handleFocusIn"
      @focusout="handleFocusOut"
    >
      <!-- Slot of a Jetzt card deleted inside its undo window (#422): ahead of the cards when it was first -->
      <task-deleted-gap v-for="gap in gapsBefore" :key="gap.taskId" :gap="gap" />
      <!-- Progress tasks are never grouped -->
      <sortable-task-wrapper
        v-for="(task, index) in tasks"
        :key="task.id"
        :task-id="task.id"
        :index="index"
        :task-status="props.taskStatus"
      >
        <task-card-context-menu :task="task">
          <task-card
            :task="task"
            :muted="false" 
            :style="{ '--item-index': index }"
            @open="$emit('open-task', $event)"
          />
        </task-card-context-menu>
      </sortable-task-wrapper>
      <task-deleted-gap v-for="gap in gapsAfter" :key="gap.taskId" :gap="gap" />
      <!-- Droppable sentinel: ensures dnd-kit can accept drops even when the column is empty -->
      <column-drop-zone :task-status="props.taskStatus" :is-empty="isEmpty" />
    </div>

    <!-- Add-and-start slot (#125), with the task list's inset so it lines up with a card: only while Jetzt is empty and nothing is dragged (WIP 1).
         Absolutely positioned so it overlays the drop zone instead of stacking below it,
         keeping the column height fixed to one task card at all times. The section hover that
         reveals it is CSS (AddTaskSlot). The layout is fixed while the draft is saved (slotOverlays). -->
    <div
      v-if="showSlot"
      class="px-3 md:px-10"
      :class="slotOverlays ? 'add-task-slot-overlay' : 'mt-2'"
    >
      <add-task-slot
        :status="TaskStatus.Progress"
        :label="t('task.createAdHoc')"
        icon="i-ph-lightning"
        :show-button="isEmpty && !props.isDragging"
        @open="openAdHocTaskCreation"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { navigateTo } from 'nuxt/app';
import { useI18n } from 'vue-i18n';
import type { Task } from '~/types/task';
import type { DragState } from '~/composables/useBoardDragState';
import { TaskStatus } from '~/types/taskStatus';
import TaskCard from '~/components/task/TaskCard.vue';
import TaskCardContextMenu from '~/components/task/TaskCardContextMenu.vue';
import AddTaskSlot from '~/components/board/AddTaskSlot.vue';
import { useTaskDraft } from '~/composables/useTaskDraft';
import SortableTaskWrapper from '~/components/board/SortableTaskWrapper.vue';
import TaskDeletedGap from '~/components/task/TaskDeletedGap.vue';
import type { DeletedGap } from '~/types/deletedGap';
import ColumnDropZone from '~/components/board/ColumnDropZone.vue';

defineOptions({ name: 'BoardColumnProgressContent' });

const { t } = useI18n();

const props = defineProps<{
  /** Array of tasks to display in the progress list */
  tasks: Task[];
  /** DOM ID for the list element (required for drag-and-drop) */
  listId: string;
  /** Whether a drag operation is currently in progress */
  isDragging: boolean;
  /** Full drag state for placeholder rendering */
  dragState?: DragState | null;
  /** Task status for sortable group assignment */
  taskStatus: TaskStatus;
  /** Slots of cards deleted from Jetzt inside their undo window (#422) */
  gaps?: DeletedGap[];
}>();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const emit = defineEmits<{
  (e: 'open-task', id: string): void;
}>();

const listEl = ref<HTMLElement | null>(null);
defineExpose({ listEl });

const isEmpty = computed(() => props.tasks.length < 1);

/** Jetzt holds at most one card, so a gap is either ahead of it (it was first) or behind it. */
const hasGaps = computed(() => (props.gaps?.length ?? 0) > 0);
const gapsBefore = computed(() => (props.gaps ?? []).filter(gap => gap.afterId === null));
const gapsAfter = computed(() => (props.gaps ?? []).filter(gap => gap.afterId !== null));

const { draftTask, draftSaving } = useTaskDraft();
const isDrafting = computed(() => draftTask.value?.status === TaskStatus.Progress);

/** The slot exists while Jetzt is empty and nothing is dragged, and always while it holds the Jetzt draft. */
const showSlot = computed(() => (isEmpty.value && !props.isDragging && !hasGaps.value) || isDrafting.value);

/**
 * Overlay over the empty list, or in flow below the cards. Latched only while the Jetzt draft is being
 * saved: the saved task can land a render before the draft clears and must not push the draft out of
 * the slot's box. A Jetzt that fills while drafting (e.g. a sync) puts the draft in flow below its card.
 */
const slotOverlays = ref(isEmpty.value);
watch([isEmpty, isDrafting, draftSaving], ([empty, drafting, saving]) => {
  if (!(drafting && saving)) slotOverlays.value = empty;
});

const openAdHocTaskCreation = () => {
  if (import.meta.dev) {
    console.log('[BoardColumnProgress] Opening ad-hoc task creation');
  }
  navigateTo({ path: "/tasks/add", query: { mode: "adhoc" } });
};

// No-ops for column hover interactions (handled at parent level)
const handlePointerMove = () => {};
const handlePointerLeave = () => {};
const handleFocusIn = () => {};
const handleFocusOut = () => {};

// Debug logging
if (import.meta.dev) {
  watch(() => props.tasks, (newTasks) => {
    console.log('[BoardColumnProgress] Tasks changed:', newTasks.length);
    nextTick(() => {
      const el = listEl.value
      if (el) {
        console.log('[BoardColumnProgress] List height:', el.clientHeight + 'px');
      }
    });
  }, { deep: true });
}
</script>

<style scoped>
/* ========================================
 * PROGRESS COLUMN CONTENT WRAPPER
 * ======================================== */

.progress-column-content-wrapper {
  flex: 1;
  min-height: var(--task-card-height);
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Progress column task-list: one regular card tall, filled or empty (#394): Wartet below never jumps when the card
   enters or leaves Jetzt. The drop sentinel therefore overlays the list instead of adding its own 80px below the card. */
.progress-column-content-wrapper .task-list {
  position: relative;
  gap: 0.5rem;
  min-height: var(--task-card-height); /* Ensures adequate drop area when empty */
}

.progress-column-content-wrapper .task-list :deep(.column-drop-zone) {
  position: absolute;
  inset: 0;
  min-height: 0;
}

/* Overlay wrapper: sits on top of the drop zone, no flex space consumed */
.add-task-slot-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-card);
  pointer-events: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.add-task-slot-overlay :deep(.add-task-slot) {
  pointer-events: auto;
}

</style>
