<!--
@component BoardColumn
@kind compound
@category layout
@description Column component for the kanban board that displays tasks of a specific status
@usage Used within the main board layout to organize tasks by their status
@avoid Not for the Jetzt column, whose single card has its own content (BoardColumnProgressContent); not a drop target on its own (ColumnDropZone).
@responsibility
- Displays tasks of a specific status (Today, Doing, Waiting, Done)
- Grouped columns: renders each group of 2+ as a collapsed TaskStack or, once expanded, as a header
  row (#148) and ordinary sortable cards (#147); owns the outside-click/Escape/"Schließen" collapse
  of its stacks
- Renders dedicated progress bar section for Progress column (separate from task list)
- Provides header with status information
- Enables task addition for the Open column (#248): the header's round add button asks the add slot, the draft host at the start of the list, to open; the draft card enters at the top (#125). Cancel returns focus to the header button
- Handles visual states for different statuses and empty states
- Erledigt drop target (#124): a light green wash under the list and a one-line hint while a card
  from another column hovers it
-->
<template>
  <div
    :id="columnId"
    ref="columnEl"
    class="column relative flex flex-col"
    :class="columnClasses"
    :data-status="statusAttr"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <board-column-header
      ref="headerRef"
      :title="computedHeadline"
      :status="taskStatus"
      :task-count="tasks.length"
      :is-empty="isEmpty && !hasGaps"
      :show-add="showAddButton"
      :add-disabled="addSlotRef?.isDrafting ?? false"
      @add="addSlotRef?.open()"
    />

    <!-- Spacer with centered Sorting Control (Erledigt: the drop hint while a card hovers it, #124) -->
    <div class="relative flex h-10 items-center justify-center">
      <column-sorting-control
        v-if="!isProgressColumn && tasks.length >= 2"
        :visible="(isHovering || isSortingOpen) && !props.isDragging"
        :status="taskStatus"
        :sorting="columnSorting"
        @change="handleSortingChange"
        @open-change="(open) => isSortingOpen = open"
      />
      <Transition name="done-drop-hint">
        <p
          v-if="isDoneDropTarget"
          class="done-drop-hint absolute inset-x-0 truncate px-3 text-center text-sm font-medium text-success-800"
        >
          {{ t('board.dropToComplete') }}
        </p>
      </Transition>
    </div>

    <!-- "Gestern erledigt" note for tasks finished before today (bounded height, one action) -->
    <Transition name="yesterday-note">
      <board-column-yesterday-note
        v-if="isDoneColumn && tasksDonePrevious.length > 0"
        :tasks="tasksDonePrevious"
        :class="{ 'task-list--leaving': boardStore.doneLeaving }"
        @acknowledge="handleArchive"
      />
    </Transition>
    
    <!-- Progress Column Content -->
    <board-column-progress-content
      v-if="isProgressColumn"
      ref="progressListRef"
      :tasks="dndTasks"
      :list-id="listId"
      :is-dragging="props.isDragging"
      :drag-state="dragState"
      :task-status="taskStatus"
      :gaps="columnGaps"
      @open-task="openTask"
    />
    
    <!-- Other columns: standard layout -->
    <div
      v-else
      :id="listId"
      ref="standardListRef"
      :data-task-status="taskStatus"
      class="task-list min-h-[150px] overflow-visible px-3 text-center md:px-10"
      :class="{ 'task-list--stacking': isGroupingActive, 'task-list--leaving': isDoneColumn && boardStore.doneLeaving, 'task-list--end-footer': isDoneColumn && !!$slots.footer && !props.isDragging, 'flex-1': !isOpenColumn || props.isDragging }"
      :data-stack-mode="isGroupingActive ? 'true' : null"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
      @focusin="handleFocusIn"
      @focusout="handleFocusOut"
    >
      <!-- Add slot (Open column only, #125, #248): the draft host at the start of the list. It has no box while no draft is
           open (no gap above the first card); the header button opens it. Inside the flex container so gap spacing applies -->
      <add-task-slot
        v-if="showAddSlot"
        ref="addSlotRef"
        :status="TaskStatus.Open"
        :label="t('board.addTask')"
        :show-button="false"
        :hidden="props.isDragging"
        :in-card="true"
        :focus-fallback="() => headerRef?.addButtonEl() ?? null"
      />
      <!-- One flat list of items: ungrouped cards, then (grouped) a collapsed stack or the cards of an
           expanded one in its place (#147), or (ungrouped mode) every task in order -->
      <board-column-item
        v-for="item in columnItems"
        :key="item.key"
        :item="item"
        :task-status="taskStatus"
        :static-mode="props.staticMode"
        @open="openTask"
        @expand="expandStack"
        @close-stack="closeStack"
      />
      <!-- Droppable sentinel: ensures dnd-kit can accept drops even when the column is empty -->
      <column-drop-zone :task-status="taskStatus" :is-empty="isEmpty" />
    </div>
    <!-- Footer slot for column-specific bottom content (e.g., add button in Open column, sync controls in Done column) -->
    <div v-if="$slots.footer" class="column-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { focusFirstAvailable } from "~/utils/focusRecovery";
import { ref, computed, nextTick, watch } from "vue";
import type { PropType } from "vue";
import { useI18n } from "vue-i18n";
import BoardColumnProgressContent from "~/components/board/BoardColumnProgressContent.vue";
import BoardColumnYesterdayNote from "~/components/board/BoardColumnYesterdayNote.vue";
import AddTaskSlot from "~/components/board/AddTaskSlot.vue";
import ColumnSortingControl from "~/components/board/ColumnSortingControl.vue";
import BoardColumnItem from "~/components/board/BoardColumnItem.vue";
import ColumnDropZone from "~/components/board/ColumnDropZone.vue";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "~/types/task";
import type { GroupKey } from "~/types/boardGrouping";
import type { ColumnItem } from "~/types/columnItem";
import type { SortField, SortDirection } from "~/types/state";
import { buildColumnItems } from "~/utils/columnItems";
import {
  getGroupLabel,
  getStackKeys,
  groupTasksByKey,
  isGroupingActiveFor,
} from "~/utils/taskGrouping";
import { useTasksStore } from "~/store/tasks";
import { useBoardStore } from "~/store/board";
import { useBoardDragState } from "~/composables/useBoardDragState";
import { useStackExpansion } from "~/composables/useStackExpansion";
import { useStackMotion } from "~/composables/useStackMotion";
import { useDeletedGaps } from "~/composables/useDeletedGaps";
import { useColumnStackCollapse } from "~/composables/useColumnStackCollapse";
import { useFeatureFlags } from "~/utils/featureFlags";

defineOptions({ name: "BoardColumn" });

const { t } = useI18n();
const tasksStore = useTasksStore();
const boardStore = useBoardStore();
const { dragState } = useBoardDragState();

const isHovering = ref(false);
const isSortingOpen = ref(false);

const props = defineProps({
  /** Optional override; defaults to the localized column title for the status. */
  headline: {
    type: String,
    default: undefined,
  },
  staticMode: {
    type: Boolean,
    default: false,
  },
  tasks: {
    type: Array as PropType<Task[]>,
    default() {
      return [];
    },
    // not required due to default
  },
  taskStatus: {
    type: Number as PropType<TaskStatus>,
    required: true,
  },
  isDragging: {
    type: Boolean,
    required: true,
  },
  muteOthers: {
    type: Boolean,
    default: false,
  },
  groupingEnabled: {
    type: Boolean,
    default: false,
  },
  groupingKey: {
    type: String as PropType<GroupKey | null>,
    default: null,
  },
});

/**
 * Generates the column's DOM ID based on task status.
 */
const computeColumnId = (): string =>
  "column-" + TaskStatus[props.taskStatus].toLowerCase();

const columnId = computed(computeColumnId);

/**
 * Generates the task list's DOM ID based on task status.
 */
const computeListId = (): string =>
  "column-" + TaskStatus[props.taskStatus].toLowerCase() + "-list";

const listId = computed(computeListId);

/**
 * Whether this column represents the Done status.
 */
const computeIsDoneColumn = (): boolean => props.taskStatus === TaskStatus.Done;

const isDoneColumn = computed(computeIsDoneColumn);

/**
 * Whether this column represents the Open status.
 */
const isOpenColumn = computed(() => props.taskStatus === TaskStatus.Open);

/**
 * Whether this column represents the Progress status.
 */
const computeIsProgressColumn = (): boolean => props.taskStatus === TaskStatus.Progress;

const isProgressColumn = computed(computeIsProgressColumn);

// dndTasks: use props.tasks directly - dnd-kit manages its own DOM order optimistically
const dndTasks = computed(() => props.tasks);

const standardListRef = ref<HTMLElement | null>(null);
const progressListRef = ref<{ listEl: HTMLElement | null } | null>(null);

const columnSorting = computed(() => {
  return boardStore.columnByTaskStatus(props.taskStatus)?.sorting;
});

const handleSortingChange = (field: SortField, direction: SortDirection) => {
  boardStore.setColumnSorting(props.taskStatus, field, direction);
};

/**
 * Tasks done before today (archivable)
 */
const tasksDonePrevious = computed(() => {
  if (!isDoneColumn.value) return [];
  return tasksStore.tasksDonePrevious;
});

/**
 * Emit event for archive action (handled by parent)
 */
const emit = defineEmits<{
  archive: [];
}>();

/**
 * Acknowledges the yesterday note. The note (and its focused button) leaves the DOM, so focus
 * moves to the Done list, or to the column heading when today has no wins yet.
 */
const handleArchive = () => {
  emit("archive");
  // The focused button is leaving with the note: hand focus to the list, else the heading.
  void nextTick(() => {
    focusFirstAvailable([
      () => (props.tasks.length > 0 ? standardListRef.value : null),
      () => document.querySelector<HTMLElement>(`#${columnId.value} h2`),
      () => document.getElementById(columnId.value),
    ]);
  });
};

const isGroupingActive = computed(() =>
  isGroupingActiveFor(props.taskStatus, props.groupingEnabled, props.groupingKey),
);

/**
 * Groups tasks by the selected property when grouping is active.
 * Returns a Map where keys are group identifiers (e.g., "High", "Work")
 * and values are arrays of tasks belonging to each group.
 * 
 * Tasks without values for the grouping property are excluded
 * (buildColumnItems renders them as individual cards).
 */
const groupedTasks = computed<Map<string, Task[]>>(() => {
  if (!isGroupingActive.value || !props.groupingKey) {
    return new Map();
  }
  return groupTasksByKey(props.tasks, props.groupingKey);
});

/** The group key the column renders with, or null when it is not grouped */
const activeGroupKey = computed<GroupKey | null>(() => (isGroupingActive.value ? props.groupingKey : null));

// ---- Stack expansion (#147) ----
// A group of 2+ is a collapsed TaskStack until it is expanded; then its members render here as
// ordinary sortable cards in place of the stack. Which groups are expanded is in-memory state per
// column (useStackExpansion), also read by useBoardDndKit for the drop mapping.
const stacks = useStackExpansion();
// Expand/collapse motion (#197): visual only, played by the two gestures below (never by prune or
// collapseAll). The state change stays instant.
const columnEl = ref<HTMLElement | null>(null);
const stackMotion = useStackMotion({ columnEl, listEl: standardListRef });
const playStackMotion = () => void nextTick(stackMotion.play);
const expandedKeys = computed(() => stacks.expandedKeys(props.taskStatus));

/** Whether a task renders muted (focus mode); Jetzt is never muted */
const isTaskMuted = (task: Task): boolean => props.muteOthers && task.status !== TaskStatus.Progress;

/** The slots of cards deleted in this column inside their undo window (#422), placed by `buildColumnItems` */
const { gapsIn } = useDeletedGaps();
const columnGaps = gapsIn(props.taskStatus);
const hasGaps = computed(() => columnGaps.value.length > 0);

/**
 * The column's list, one entry per rendered element, top to bottom (buildColumnItems): a collapsed
 * group of 2+ is one stack, an expanded one a header row (#148) and its members as cards.
 */
const columnItems = computed<ColumnItem[]>(() =>
  buildColumnItems({
    tasks: props.tasks,
    groupKey: activeGroupKey.value,
    expandedKeys: expandedKeys.value,
    groupLabel,
    isMuted: isTaskMuted,
    groups: groupedTasks.value,
    gaps: columnGaps.value,
  }),
);

// A group that drops below two tasks stops being a stack: forget its expansion. Grouping turned off
// or switched to another key: forget all of them.
watch(
  () => getStackKeys(props.tasks, activeGroupKey.value, groupedTasks.value),
  (keys) => stacks.prune(props.taskStatus, keys),
  { immediate: true },
);
watch([isGroupingActive, () => props.groupingKey], () => {
  stacks.collapseAll(props.taskStatus);
});

const stackCollapse = useColumnStackCollapse({
  listEl: standardListRef,
  hasExpanded: () => expandedKeys.value.length > 0,
  onOutsideClick: (keepKey) => closeStacks(expandedKeys.value.filter((key) => key !== keepKey), false),
  onEscape: () => closeStacks([...expandedKeys.value], true),
});

const groupLabel = (groupKey: string) =>
  getGroupLabel(groupKey, props.groupingKey, groupedTasks.value.get(groupKey)?.[0]);

const focusStackItem = (selector: string) => {
  void nextTick(() => {
    const el = standardListRef.value?.querySelector<HTMLElement>(selector);
    if (!el) return;
    // dnd-kit makes the wrapper focusable once its sortable registered; do not wait for that
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    el.focus({ preventScroll: true });
  });
};

/** Click, tap, Enter or Space on a collapsed stack. Keyboard focus follows into the first member. */
const expandStack = (groupKey: string, source: "pointer" | "keyboard", event?: MouseEvent) => {
  const members = groupedTasks.value.get(groupKey);
  if (!members || members.length < 2 || stackCollapse.isDragActive()) return;
  // The click that ends a drag is the drag's, not a request to expand (matched by event identity)
  if (event && stackCollapse.isDragClick(event)) return;
  stackMotion.capture(groupKey, "expand");
  stacks.expand(props.taskStatus, groupKey, source);
  playStackMotion();
  // Esc and the keyboard are not the hint for a pointer user: they get "Use Close to collapse"
  const message = source === "keyboard" ? "board.stack.opened" : "board.stack.openedPointer";
  stacks.announceStack(t(message, { group: groupLabel(groupKey), count: members.length }));
  if (source === "keyboard") {
    focusStackItem(`.task-wrapper[data-task-id="${CSS.escape(members[0]!.id)}"]`);
  }
};

/**
 * Collapses the given groups. With `restoreFocus` (Escape) focus returns to the stack control of the
 * group that holds focus, else of the one opened last. Only when focus is in this column's list or
 * lost (its member just left the DOM): Escape pressed from the app bar or another column leaves focus alone.
 */
const closeStacks = (keys: string[], restoreFocus: boolean) => {
  if (keys.length === 0) return;
  const focused = document.activeElement?.closest<HTMLElement>("[data-from-stack], [data-stack-header]");
  const active = document.activeElement;
  const focusIsHere = !active || active === document.body || !!standardListRef.value?.contains(active);
  const focusKey = restoreFocus && focusIsHere
    ? (keys.find((key) => key === (focused?.dataset.fromStack ?? focused?.dataset.stackHeader)) ?? keys[keys.length - 1]!)
    : null;
  stackMotion.capture(keys, "collapse");
  keys.forEach((key) => {
    const count = groupedTasks.value.get(key)?.length ?? 0;
    stacks.collapse(props.taskStatus, key);
    stacks.announceStack(t("board.stack.closed", { group: groupLabel(key), count }));
  });
  playStackMotion();
  if (focusKey !== null) {
    focusStackItem(`.task-stack[data-stack-key="${CSS.escape(focusKey)}"] .task-stack__control`);
  }
};

/**
 * "Schließen" in a group's header row. Keyboard: collapses it and returns focus to the stack, like
 * Escape. Mouse or touch: collapses only, focus stays where the pointer put it.
 */
const closeStack = (groupKey: string, source: "pointer" | "keyboard") => closeStacks([groupKey], source === "keyboard");

const featureFlags = useFeatureFlags();

/**
 * The Open column's add slot is the draft host at the start of the list (#248): it exists on every live Open column,
 * so a draft opened another way (the sheet path) shows its card at the top too. It takes no space while idle.
 */
const showAddSlot = computed(() => isOpenColumn.value && !props.staticMode);

/** The header's round add button: the flag gates it, not a draft opened another way */
const showAddButton = computed(() => showAddSlot.value && featureFlags.openColumnAddButton);

const headerRef = ref<{ addButtonEl: () => HTMLElement | null } | null>(null);
const addSlotRef = ref<{ open: () => void; isDrafting: boolean } | null>(null);

// Mouse event handlers
const handleMouseEnter = () => {
  isHovering.value = true;
};

const handleMouseLeave = () => {
  isHovering.value = false;
};

// Hover/focus handlers kept as no-ops for template compatibility
const handlePointerMove = () => {};
const handlePointerLeave = () => {};
const handleFocusIn = () => {};
const handleFocusOut = () => {};

/**
 * Computes the displayed headline, adding a question mark for empty Waiting columns.
 */
const computeHeadline = (): string => {
  const base = props.headline ?? defaultHeadline();
  if (props.taskStatus === TaskStatus.Waiting && props.tasks.length < 1 && !hasGaps.value) {
    return base + t("board.emptyWaitingSuffix");
  } else {
    return base;
  }
};

/**
 * Localized column title for the current status.
 */
const defaultHeadline = (): string => {
  switch (props.taskStatus) {
    case TaskStatus.Open: return t("board.columns.open");
    case TaskStatus.Progress: return t("board.columns.progress");
    case TaskStatus.Waiting: return t("board.columns.waiting");
    case TaskStatus.Done: return t("board.columns.done");
    default: return "";
  }
};

const computedHeadline = computed(computeHeadline);

// Muting behavior is provided by parent via `muteOthers` prop

/**
 * Whether this column contains no tasks.
 */
const computeIsEmpty = (): boolean => props.tasks.length < 1;

const isEmpty = computed(computeIsEmpty);

/**
 * Navigates to the task detail view
 */
const openTask = (id: string) => {
  if (props.staticMode) {
    return;
  }
  navigateTo({ path: `/tasks/${id}` });
};

/**
 * Resolves the list element for external use (e.g. gradient position calculation).
 */
const getListElement = (): HTMLElement | null => {
  if (isProgressColumn.value) {
    return progressListRef.value?.listEl ?? null;
  }
  return standardListRef.value ?? null;
};

defineExpose({ getListElement });

const statusAttr = computed(() => TaskStatus[props.taskStatus].toLowerCase());

/**
 * Erledigt is the drop target of a card from another column (#124): wash + hint. A drag that
 * starts in Erledigt itself only reorders, so it shows neither.
 */
const isDoneDropTarget = computed(
  () =>
    isDoneColumn.value &&
    dragState.value.isDragging &&
    dragState.value.hoverTargetStatus === TaskStatus.Done &&
    dragState.value.sourceStatus !== TaskStatus.Done,
);

/**
 * Computed CSS classes for column state
 */
const columnClasses = computed(() => ({
  'column-empty': isEmpty.value && !hasGaps.value,
  'is-done-drop-target': isDoneDropTarget.value,
  'dragover': dragState.value.isDragging && dragState.value.hoverTargetStatus === props.taskStatus,
}));
</script>

<style scoped>
/* ========================================
 * ERLEDIGT DROP TARGET (#124)
 * A light green wash on the column itself, so it sits under the list and the Gestern note and
 * covers the scrolled content on mobile. It fades on the column, never on .board (DnD invariant).
 * ======================================== */
.column[data-status="done"] {
  border-radius: var(--task-card-radius);
  transition: background-color var(--done-wash-duration) var(--ease-standard);
}

.column[data-status="done"].is-done-drop-target {
  background-color: var(--done-wash);
}

/* Header in the 800 step on the wash (~5.7:1) */
.column[data-status="done"].is-done-drop-target :deep(.column-header h2) {
  color: var(--ui-color-success-800);
}

/* Empty Erledigt: the ColumnDropZone ghost is the landing slot; tinted so it reads on the wash */
.column[data-status="done"].is-done-drop-target :deep(.column-drop-zone__ghost) {
  background-color: color-mix(in oklab, var(--ui-color-success-700) 16%, transparent);
}

.done-drop-hint-enter-active,
.done-drop-hint-leave-active {
  transition: opacity var(--done-wash-duration) var(--ease-standard);
}

.done-drop-hint-enter-from,
.done-drop-hint-leave-to {
  opacity: 0;
}

@media (--phone) {
  .column[data-status="done"] {
    border-radius: 0;
  }
}

/* Reduced motion: wash, header colour (BoardColumnHeader) and hint all read this duration */
@media (prefers-reduced-motion: reduce) {
  .column[data-status="done"] {
    --done-wash-duration: 0ms;
  }
}

/* Day close (#292): the Erledigt list fades out before its tasks are archived (useDayClose; none under reduced motion, it
   does not set the flag then). Opacity only, on the list, so cards, stacks and gaps leave together without touching dnd-kit; the yesterday note fades with them. */
.task-list--leaving {
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-base) var(--ease-standard);
}

/* ========================================
 * COLUMN FOOTER
 * ======================================== */
.column-footer {
  position: sticky;
  /* 0 on every size: on the phone #column-done already pads its bottom by the bar offset (board.css), which shrinks
     the sticky view; adding --phone-bar-offset again pinned the CTA ~72px too high (AddTaskSlot does the same) */
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 1rem 0;
  /* Above the cards (z-index 100 + index, board.css) so the sticky CTA is never painted under a card; below the
     stack control (500) and the focus overlay's lift (1100, board-focus-overlay.css) */
  z-index: var(--z-column-footer);
}

/* Phone (#297): the CTA is the end of the list, not an overlay above the app bar: the footer follows the last card (the column
   page's bottom padding already clears the bar) and its content takes the cards' width (Board.vue) */
@media (--phone) {
  .column-footer {
    position: static;
  }

  /* The list stops stretching to the page's height while the footer follows it, so the CTA sits right under the last card
     instead of at the bottom of the page; a drag restores the stretch (the whole page is the drop target, as in Offen) */
  .task-list--end-footer {
    flex: 0 0 auto;
  }
}
</style>
