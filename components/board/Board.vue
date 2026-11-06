<!--
@component Board
@description Main kanban board component that organizes and displays tasks by status
@usage Used on the main page to provide the core task management interface
@responsibility
- Renders the complete kanban board with all columns
- Manages drag-and-drop functionality between columns
- Handles task status changes and column order updates
- Provides visual feedback during task interactions
- Phone: three column pages moved by swipe and drag edge-scroll only (no tabs, #470); the active page is `data-mobile-page`
  and focus entering an off-screen page makes it active (the keyboard / screen-reader path the tabs were)
- Erledigt footer: the "Tag abschließen" CTA while something is done today
-->
<template>
  <DragDropProvider :plugins="dndPlugins" :sensors="dndSensors" @drag-start="onDragStart" @drag-over="onDragOver" @drag-end="onDragEnd">
  <div
    class="board-container"
    :data-sheet-task-id="spotlightTaskId ?? undefined"
    @pointerdown="onSwipePointerDown"
    @focusin="onBoardFocusIn"
  >
    <!-- Stacks opening and closing (TaskStack), read out politely -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ stackAnnouncement }}</div>
    <img class="background-img" src="~/assets/img/plants.svg" alt="" aria-hidden="true">
    <div
      class="board"
      :class="{ 'dragging': isDragging, 'swiping': isSwiping }"
      :style="mobileBoardStyle"
      :data-focus="focusEnabledNow ? '' : undefined"
      :data-focus-lit="focusEnabledNow && focusShown ? '' : undefined"
      :data-mobile-page="activeMobileTab"
    >
      <!-- Focus overlay (#394): first child, so the layer rules in board-focus-overlay.css apply -->
      <FocusOverlay
        v-if="focusEnabledNow || focusLeaving"
        :on="focusShown"
        :leaving="focusLeaving"
        :touch="focusPointerKind === 'touch'"
        :swallow-tap="focusSwallowTap"
      />
      <BoardColumn
        :tasks="tasksOpen"
        :task-status="TaskStatus.Open"
        :is-dragging="isDragging"
        :mute-others="false"
        :grouping-enabled="groupingEnabled"
        :grouping-key="groupingKey"
      />
      <!-- Progress + Waiting share one scroll-page on mobile -->
      <div class="column-group-mid">
        <BoardColumn
          :tasks="tasksProgress"
          :task-status="TaskStatus.Progress"
          :is-dragging="isDragging"
          :mute-others="false"
          :grouping-enabled="groupingEnabled"
          :grouping-key="groupingKey"
        />
        <BoardColumn
          :tasks="tasksWaiting"
          :task-status="TaskStatus.Waiting"
          :is-dragging="isDragging"
          :mute-others="false"
          :grouping-enabled="groupingEnabled"
          :grouping-key="groupingKey"
        />
      </div>
      <BoardColumn
        :tasks="tasksDone"
        :task-status="TaskStatus.Done"
        :is-dragging="isDragging"
        :mute-others="false"
        :grouping-enabled="groupingEnabled"
        :grouping-key="groupingKey"
        @archive="handleArchiveTasks"
      >
        <!-- "Tag abschließen" under the last card (#470); hidden while nothing is done today (the Mehr panel row stays) -->
        <template v-if="tasksDone.length > 0" #footer>
          <div class="flex w-full justify-center max-md:px-3">
            <UButton
              icon="i-ph-sun-horizon"
              color="neutral"
              variant="soft"
              size="lg"
              class="bg-default shadow-md ring ring-default max-md:w-full max-md:justify-center"
              data-testid="day-close-cta"
              @click="openDayClose"
            >
              {{ t('nav.dayClose') }}
            </UButton>
          </div>
        </template>
      </BoardColumn>
    </div>

    <!-- Mobile edge-scroll indicators: appear while dragging near the screen edge -->
    <template v-if="isDragging">
      <div
        v-if="activeMobileTab > 0"
        class="edge-indicator edge-indicator--left md:hidden"
        :class="{ 'edge-indicator--charging': edgeDirection === 'left' }"
        :style="edgeIndicatorStyle"
        aria-hidden="true"
      >
        <UIcon name="ph:caret-left-bold" class="size-6" />
      </div>
      <div
        v-if="activeMobileTab < 2"
        class="edge-indicator edge-indicator--right md:hidden"
        :class="{ 'edge-indicator--charging': edgeDirection === 'right' }"
        :style="edgeIndicatorStyle"
        aria-hidden="true"
      >
        <UIcon name="ph:caret-right-bold" class="size-6" />
      </div>
    </template>
  </div>

  <!-- Drag overlay: renders a floating task card clone while dragging -->
  <DragOverlay :drop-animation="{ duration: 150, easing: 'ease-out' }">
    <template v-if="dragState.draggedTaskId" #default>
      <!-- A whole stack (#150): its collapsed face as it rests, not only the front card -->
      <task-stack
        v-if="draggingStack"
        :stack-key="draggingStack.key"
        :label="draggingStack.label"
        :tasks="draggingStack.tasks"
        :task-status="dragState.sourceStatus ?? TaskStatus.Open"
        :sortable-index="0"
        :muted="false"
        preview
        class="kando-dnd-preview"
      />
      <task-card
        v-else-if="draggingTask"
        :task="draggingTask"
        :muted="false"
        preview
        class="kando-dnd-preview"
      />
    </template>
  </DragOverlay>
  </DragDropProvider>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useBoardStore } from "~/store/board";
import { useTasksStore } from "~/store/tasks";
import { useBoardGrouping } from "~/composables/useBoardGrouping";
import { useBoardDndKit } from "~/composables/useBoardDndKit";
import { useBoardSwipe } from "~/composables/useBoardSwipe";
import { useEdgeIndicatorTop } from "~/composables/useEdgeIndicatorTop";
import { useBoardAnnouncements } from "~/composables/useBoardAnnouncements";
import { useStackExpansion } from "~/composables/useStackExpansion";
import { TaskStatus } from "~/types/taskStatus";
import { useBoardDragState } from "~/composables/useBoardDragState";
import { useSheetSpotlight } from "~/composables/useSheetSpotlight";
import { DragDropProvider, DragOverlay } from "@dnd-kit/vue";
import TaskCard from "~/components/task/TaskCard.vue";
import TaskStack from "~/components/task/TaskStack.vue";
import FocusOverlay from "~/components/board/FocusOverlay.vue";
import { FOCUS_LEAVE_MS, useFocusOverlay } from "~/composables/useFocusOverlay";
import { useOpenLayer } from "~/composables/useOpenLayer";
import { useNewDayRecap } from "~/composables/useNewDayRecap";
import { useSettingsStore } from "~/store/settings";
import { useArchiveDoneTasks } from "~/composables/useArchiveDoneTasks";
import { useDayClose } from "~/composables/useDayClose";

/**
 * Script-API: orchestrates kanban data via stores/composables, wires DnD
 * with rAF-throttled hover updates, and persists order/status changes. Dev logging is guarded.
 */
defineOptions({ name: "Board" });

const tasksStore = useTasksStore();
const boardStore = useBoardStore();
const { archiveTasks } = useArchiveDoneTasks();
const { open: openDayClose } = useDayClose();
const { t } = useI18n();
const { dragState } = useBoardDragState();
const { stackAnnouncement } = useStackExpansion();
const { spotlightTaskId } = useSheetSpotlight();
const { onDragStart, onDragOver, onDragEnd, refreshDroppableShapes } = useBoardDndKit();
const { plugins: dndPlugins, sensors: dndSensors } = useBoardAnnouncements();

const draggingTask = computed(() =>
  dragState.value.draggedTaskId
    ? (tasksStore.task(dragState.value.draggedTaskId) ?? null)
    : null
);

/** The members of the dragged stack as they were at drag start; ones that are gone are left out */
const draggingStack = computed(() => {
  const stack = dragState.value.draggedStack;
  if (!stack) return null;
  const tasks = stack.taskIds.flatMap((id) => tasksStore.task(id) ?? []);
  return tasks.length > 0 ? { key: stack.key, label: stack.label, tasks } : null;
});

/** Tracks whether a task is currently being dragged */
const isDragging = computed(() => dragState.value.isDragging);

const groupingEnabled = computed(() => boardStore.grouping.enabled);
const { effectiveGroupKey: groupingKey } = useBoardGrouping();

/**
 * Tasks in the Open/Today column.
 */
const tasksOpen = computed(() => tasksStore.tasksOpen);

/**
 * Tasks in the Progress/Doing column.
 */
const tasksProgress = computed(() => tasksStore.tasksProgress);

/**
 * Tasks in the Waiting column.
 */
const tasksWaiting = computed(() => tasksStore.tasksWaiting);

/**
 * Tasks in the Done column (only today's completions).
 * Yesterday's tasks are rendered separately in the archive section.
 */
const tasksDone = computed(() => tasksStore.tasksDoneToday);

// ── Mobile column navigation (transform-based) ───────────────────────────────
// The board is 300vw wide on mobile. .board-container clips it to 100vw.
// activeMobileTab drives translateX so no scroll container is needed. No tabs (#470): a swipe, the drag
// edge-scroll and focus entering a page move it; it is exposed as data-mobile-page on .board.

/** Index of the currently-visible column page on mobile (0=Open, 1=Mid, 2=Done) */
const activeMobileTab = ref(0);

/** True when the viewport is ≤767 px (updated reactively via MediaQueryList) */
const isMobile = ref(false);
let _mobileMediaQuery: MediaQueryList | null = null;

/** Highest column-page index (0=Open, 1=Mid, 2=Done). */
const LAST_MOBILE_TAB = 2;

/** Navigate to the given column page (0-2). */
const scrollToTab = (index: number) => {
  activeMobileTab.value = index;
};

/** Page index (0-2) of a column element: Offen, the Jetzt/Wartet group, Erledigt */
const pageOf = (el: Element): number | null => {
  if (el.closest('#column-open')) return 0;
  if (el.closest('.column-group-mid')) return 1;
  if (el.closest('#column-done')) return 2;
  return null;
};

/**
 * Phone: focus moving into a control on an off-screen column page makes that page active. The tabs were the keyboard
 * and screen-reader path to the other pages; without them a Tab would land in a page the transform has pushed out of view.
 */
const onBoardFocusIn = (event: FocusEvent) => {
  if (!isMobile.value || isDragging.value || !(event.target instanceof Element)) return;
  const page = pageOf(event.target);
  if (page !== null && page !== activeMobileTab.value) scrollToTab(page);
};

// ── Focus overlay (#394) ───────────────────────────────────────────────────────
const settingsStore = useSettingsStore();
const { layerOpen } = useOpenLayer();
/** The new-day recap (#385) is a Teleport overlay without Reka's body lock, so `layerOpen` does not see it */
const { isOpen: recapOpen } = useNewDayRecap();
/** Setting on, a card in Jetzt, nothing dragged, no sheet, layer or new-day recap open, and (phone) the Jetzt page is the visible one */
const focusEnabledNow = computed(
  () =>
    settingsStore.focusEnabled &&
    tasksProgress.value.length > 0 &&
    !isDragging.value &&
    !spotlightTaskId.value &&
    !layerOpen.value &&
    !recapOpen.value &&
    (!isMobile.value || activeMobileTab.value === 1),
);
const { shown: focusShown, pointerKind: focusPointerKind, swallowTap: focusSwallowTap } = useFocusOverlay(focusEnabledNow);

/** The card left Jetzt (done, waiting, synced away) while the overlay was up: it stays mounted to fade out (#394).
 *  A drag, an open sheet or layer still remove it at once. `data-focus` follows `focusEnabledNow`, so the layer rules go now. */
const focusLeaving = ref(false);
let focusLeavingTimer: ReturnType<typeof setTimeout> | null = null;
watch(focusEnabledNow, (now, was) => {
  if (focusLeavingTimer) clearTimeout(focusLeavingTimer);
  focusLeavingTimer = null;
  focusLeaving.value = false;
  if (was && !now && tasksProgress.value.length === 0 && !isDragging.value && !spotlightTaskId.value && !layerOpen.value) {
    focusLeaving.value = true;
    focusLeavingTimer = setTimeout(() => {
      focusLeaving.value = false;
      focusLeavingTimer = null;
    }, FOCUS_LEAVE_MS);
  }
});
onBeforeUnmount(() => {
  if (focusLeavingTimer) clearTimeout(focusLeavingTimer);
});

// ── Swipe gestures (column switching when not dragging) ───────────────────────
// Axis lock + finger-follow live in useBoardSwipe. It stands down while a dnd-kit drag is
// active, so a drop gesture can never switch the page.

const {
  offsetPx: swipeOffsetPx,
  isSwiping,
  onPointerDown: onSwipePointerDown,
} = useBoardSwipe({
  activeTab: activeMobileTab,
  lastTab: LAST_MOBILE_TAB,
  isEnabled: () => isMobile.value && !isDragging.value,
  onCommit: scrollToTab,
});

/**
 * CSS transform that slides the board to show the active column on mobile, plus the
 * transient finger-follow offset while a swipe is live.
 * Returns an empty object on desktop so the grid layout is unaffected.
 */
const mobileBoardStyle = computed<{ transform?: string }>(() => {
  if (!isMobile.value) return {};
  const offset = swipeOffsetPx.value !== 0 ? ` + ${Math.round(swipeOffsetPx.value)}px` : '';
  return { transform: `translateX(calc(${-activeMobileTab.value} * 100vw${offset}))` };
});

// ── Mobile edge-scroll during drag ────────────────────────────────────────────

/** Width of the hot zone at each screen edge that triggers a column scroll */
const EDGE_ZONE_PX = 72;
/** Milliseconds the pointer must remain in the edge zone before scrolling fires */
const EDGE_HOLD_MS = 650;
/** Cooldown after a scroll fires to prevent back-to-back triggers (ms) */
const EDGE_COOLDOWN_MS = 500;

/** Reactive direction so the edge-indicator template can show the charging state */
const edgeDirection = ref<'left' | 'right' | null>(null);

let edgeScrollTimer: ReturnType<typeof setTimeout> | null = null;
let edgeScrollCooldown = false;

const clearEdgeTimer = () => {
  if (edgeScrollTimer !== null) {
    clearTimeout(edgeScrollTimer);
    edgeScrollTimer = null;
  }
  edgeDirection.value = null;
};

const fireEdgeScroll = (direction: 'left' | 'right') => {
  if (edgeScrollCooldown) return;
  const target = direction === 'right'
    ? Math.min(activeMobileTab.value + 1, 2)
    : Math.max(activeMobileTab.value - 1, 0);
  if (target === activeMobileTab.value) return;

  scrollToTab(target);
  refreshDroppableShapes();
  edgeScrollCooldown = true;
  edgeDirection.value = null;
  setTimeout(() => { edgeScrollCooldown = false; }, EDGE_COOLDOWN_MS);
};

/**
 * Tracks pointer position during drag and triggers a column scroll when the
 * pointer dwells inside the left / right edge zone for EDGE_HOLD_MS.
 * Only active on mobile (max-width: 767px).
 */
const handleDragPointerMove = (event: PointerEvent) => {
  if (!isDragging.value || !import.meta.client) return;
  if (!window.matchMedia('(max-width: 767px)').matches) {
    clearEdgeTimer();
    return;
  }

  const x = event.clientX;
  const vw = window.innerWidth;
  const dir: 'left' | 'right' | null =
    x < EDGE_ZONE_PX ? 'left' :
    x > vw - EDGE_ZONE_PX ? 'right' :
    null;

  if (dir === edgeDirection.value) return; // unchanged — keep existing timer

  clearEdgeTimer();
  edgeDirection.value = dir;

  if (dir !== null) {
    edgeScrollTimer = setTimeout(() => {
      fireEdgeScroll(dir);
      edgeScrollTimer = null;
    }, EDGE_HOLD_MS);
  }
};

// Edge arrows follow the active page's header row, clamped at the top (#231)
const COLUMN_PAGE_SELECTORS = ['#column-open', '.column-group-mid', '#column-done'];
const { top: edgeIndicatorTopPx } = useEdgeIndicatorTop({
  isActive: computed(() => isDragging.value && isMobile.value),
  activeTab: activeMobileTab,
  getPage: tab => document.querySelector<HTMLElement>(COLUMN_PAGE_SELECTORS[tab] ?? ''),
});
const edgeIndicatorStyle = computed(() =>
  edgeIndicatorTopPx.value === null ? undefined : { '--edge-indicator-top': `${edgeIndicatorTopPx.value}px` },
);

// Attach / detach the pointermove listener only while a drag is active
watch(isDragging, (dragging) => {
  if (!import.meta.client) return;
  if (dragging) {
    document.addEventListener('pointermove', handleDragPointerMove, { passive: true });
  } else {
    document.removeEventListener('pointermove', handleDragPointerMove);
    clearEdgeTimer();
  }
});

// ──────────────────────────────────────────────────────────────────────────────

const dragDiagnosticCleanups: Array<() => void> = [];

onMounted(() => {
  if (import.meta.client) {
    _mobileMediaQuery = window.matchMedia('(max-width: 767px)');
    isMobile.value = _mobileMediaQuery.matches;
    _mobileMediaQuery.addEventListener('change', (e) => { isMobile.value = e.matches; });
  }

  if (!import.meta.dev || !import.meta.client) {
    return;
  }

  const formatPath = (event: Event) => {
    return event.composedPath().slice(0, 8).map((node) => {
      if (!(node instanceof HTMLElement)) {
        return String(node);
      }

      const className = typeof node.className === 'string' ? node.className : '';
      return `${node.tagName}${node.id ? `#${node.id}` : ''}.${className.substring(0, 40)}`;
    });
  };

  const topElements = (event: DragEvent) => {
    return document.elementsFromPoint(event.clientX, event.clientY).slice(0, 6).map((node) => {
      const className = typeof node.className === 'string' ? node.className : '';
      const style = getComputedStyle(node);
      return `${node.tagName}${node.id ? `#${node.id}` : ''}.${className.substring(0, 40)} z:${style.zIndex} pe:${style.pointerEvents}`;
    });
  };

  const logNativeDrag = (event: Event) => {
    const dragEvent = event as DragEvent;
    const target = dragEvent.target instanceof HTMLElement ? dragEvent.target : null;
    const currentTarget = dragEvent.currentTarget instanceof HTMLElement ? dragEvent.currentTarget : null;
    const slot = target?.closest('#column-waiting, #column-open, #column-progress, #column-done')?.id ?? 'none';
    const wrapper = target?.closest('.task-wrapper') as HTMLElement | null;
    console.log('[DnD-Native]', {
      type: dragEvent.type,
      slot,
      target: target ? `${target.tagName}.${typeof target.className === 'string' ? target.className.substring(0, 40) : ''}` : null,
      currentTarget: currentTarget ? `${currentTarget.tagName}.${typeof currentTarget.className === 'string' ? currentTarget.className.substring(0, 40) : ''}` : null,
      taskId: wrapper?.getAttribute('data-task-id') ?? null,
      defaultPrevented: dragEvent.defaultPrevented,
      cancelBubble: dragEvent.cancelBubble,
      hasDataTransfer: Boolean(dragEvent.dataTransfer),
      types: dragEvent.dataTransfer ? [...dragEvent.dataTransfer.types] : null,
      dropEffect: dragEvent.dataTransfer?.dropEffect ?? null,
      effectAllowed: dragEvent.dataTransfer?.effectAllowed ?? null,
      client: { x: Math.round(dragEvent.clientX), y: Math.round(dragEvent.clientY) },
      path: formatPath(dragEvent),
      elements: topElements(dragEvent),
    });
  };

  const dragEvents: Array<keyof DocumentEventMap> = ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend'];
  for (const eventName of dragEvents) {
    document.addEventListener(eventName, logNativeDrag, true);
    dragDiagnosticCleanups.push(() => document.removeEventListener(eventName, logNativeDrag, true));
  }
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('pointermove', handleDragPointerMove);
    clearEdgeTimer();
    _mobileMediaQuery = null; // listener auto-removed when GC'd; GC is fine here
  }
  while (dragDiagnosticCleanups.length > 0) {
    const cleanup = dragDiagnosticCleanups.pop();
    cleanup?.();
  }
});

/**
 * Archives the done tasks of earlier days ("Gesehen"); no toast, no undo (#463).
 */
function handleArchiveTasks() {
  const taskIds = tasksStore.tasksDonePrevious.map(t => t.id);
  if (taskIds.length === 0) return;

  archiveTasks(taskIds);
};
</script>
