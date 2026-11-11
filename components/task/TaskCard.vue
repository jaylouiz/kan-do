<!--
@component TaskCard
@kind compound
@category display
@description Displays and manages an individual task card on the kanban board
@usage Used within BoardColumn to render task items with their properties and interactive elements
@avoid The board card; static read-only copies (trash, day close, recap) use their own rows, drafts use TaskDraftCard.
@responsibility
- Displays task information: the topic first, the title below it (#584), then the footer (timebox chip, source icon,
  carried-over dots, priority). The activity is not on the card (#584): the sheet, the grouping and the statistics keep it.
- Shows the timebox as the progress chip (#388) at the footer start (#584): a light grey chip with the spent share outside
  Jetzt, a footer-wide bar in Jetzt that grows to the right from the chip's own position; the card has no progress ring
  (the task sheet keeps its own)
- Shows the carried-over dots (#99) for not-done cards, with the numeral only past the dot cap (#584)
- Shows the source icon at the footer start on a board with tasks from 2+ sources (#323), the cloud "save pending" icon next to it while the task's source cannot sync (#319)
- Manages task timer functionality (for Progress status)
- Handles visual states for different task statuses
- Done (#124): regular sheet, struck toned title, teal corner check, and the
  short in-card confirmation after a drop into Erledigt (board store `confirmingTaskIds`)
- Done check spring (#611): the corner check springs in once, as the confirmation layer fades out, when a user action
  (drop, menu, sheet, palette: all set `confirmingTaskIds`) brought the card into Erledigt; never on load, sync or
  undo; static under reduced motion
- Completion burst (#692, DESIGN.md "Behaviour"): `TaskCompletionBurst` on the same trigger as the check
  spring, around the card for ~0.9 s; decorative, none under reduced motion
- Timebox nudge (#389): a Jetzt card without a timebox shows the in-card question (board store
  `timeboxNudgeTaskId`); its own content is hidden under it (`task--nudged`, rules in TaskTimeboxNudge)
- Opens the task sheet on a click or tap (kd#25, one gesture for every pointer; Enter via SortableTaskWrapper), lifts to the
  hovered shadow under a hovering pointer; a collapsed stack's cards never open
- Provides drag-and-drop styling
- `readonly` (#422): the card of a trash entry. Same face, but no task id on the DOM (board selectors never match it), no
  open gesture and no pointer cursor; a card that came back from an undo plays its grow-back (`task--returning`)
- No activity badge on the card: the activity is for grouping and statistics, the task sheet shows it. Cards and stacks in a column sit `--task-list-gap` (0.75rem) apart
-->
<template>
  <UCard
    class="task"
    :class="[taskClass, { muted, 'task--draft': draft, 'task--confirming': isConfirming, 'task--celebrating': burstPlaying, 'task--nudged': isNudged, 'task--readonly': readonly, 'task--returning': isTaskReturning(task.id) }]"
    :data-task-id="readonly ? undefined : task.id"
    :data-current="isCurrent ? '' : undefined"
    :data-sheet-active="spotlightTaskId === task.id ? '' : undefined"
    variant="task"
    :ui="cardUi"
    @click="openDetails"
  >
    <!-- Done (#124): the teal corner check, with or without a timebox -->
    <span
      v-if="isDone"
      class="task-progress-corner task-done-check"
      :class="{ 'task-done-check--pop': checkPopping }"
      :style="checkPopping ? confirmStyle : undefined"
      aria-hidden="true"
      @animationend="checkPopping = false"
    >
      <UIcon name="i-ph-check" class="size-5" />
    </span>
    <!-- Topic first (#584): the topic row leads, the title sits below it. Both keep room for the Done corner check. -->
    <p v-if="task.topic" class="task-topic mb-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted" :class="{ 'pr-9': isDone }" data-private>
      <TopicMark :topic="task.topic" :task="task" />
      <span class="truncate">{{ task.topic }}</span>
    </p>
    <p
      class="task-title-text"
      :class="{ 'pr-9': isDone }"
      :title="task.title"
      data-private
    >
      {{ task.title }}
    </p>
    <!-- In-card done confirmation (#124): fades in over the card, holds, fades out to its content.
         Visual only: the undo toast and the drop announcement carry the words. -->
    <span v-if="isConfirming" class="task-confirm" :style="confirmStyle" aria-hidden="true">
      <UIcon name="i-ph-check" class="task-confirm__icon" />
    </span>
    <!-- Completion burst (#692): the earned celebration around the card; decorative, owns its ~0.9 s lifetime -->
    <TaskCompletionBurst v-if="burstPlaying" @done="burstPlaying = false" />
    <!-- Timebox nudge (#389): in-card question over the face, last in DOM order so its buttons follow the card content -->
    <TaskTimeboxNudge v-if="isCurrent" :task="task" />

    <template #footer>
      <div
        ref="footerEl"
        class="task-footer flex w-full items-center gap-2"
        :style="{ '--footer-w': `${footerWidth}px` }"
      >
        <!-- Timebox as the progress item (#388), first in the footer (#584); the Jetzt draft shows its running time
             in the group below instead. It sits outside the inert group: it is the progressbar and stays in the
             accessibility tree; in Jetzt its bar grows to the right over the rest of the footer. -->
        <TaskProgressChip
          v-if="!isJetztDraft"
          :task-id="task.id"
          :time-box-seconds="task.timeBoxSeconds"
          :time-spent-seconds="task.timeSpentSeconds"
          :is-now="isCurrent"
        />
        <!-- Under the Jetzt bar (#388) the group is covered: inert keeps it out of the tab order and the click path, so
             no focus ring hides under the bar and a tap on the bar reaches the card -->
        <div class="flex min-w-0 items-center gap-2" :inert="barCoversFooter || undefined" data-testid="task-footer-lead">
          <!-- Source icon (#323) and the cloud (#319): one unit with a 4px gap. The icon shows
               only on a board with tasks from 2+ sources (never on the add sheet's draft). The sync button names
               the source that is the problem; the card shows nothing else about source health. -->
          <span v-if="showSourceIcon || savePending" class="flex shrink-0 items-center gap-1">
            <TaskSourceIcon v-if="showSourceIcon" :source="task.source" />
            <UIcon
              v-if="savePending"
              name="i-ph-cloud-arrow-up"
              class="task-save-pending size-4 shrink-0 text-muted"
              role="img"
              :aria-label="savePendingLabel"
              :title="savePendingLabel"
              data-testid="task-save-pending"
            />
          </span>
          <!-- Jetzt draft (#125): the running time sits at the start of the footer, the part of the
               card the open sheet never covers -->
          <span
            v-if="isJetztDraft"
            class="task-draft-elapsed text-sm font-medium text-highlighted tabular-nums"
            :aria-label="t('task.elapsedAria', { time: elapsedLabel })"
          >{{ elapsedLabel }}</span>
          <!-- Width rule (#323, #584): when the footer row is too narrow the end of the carry-over dots is clipped first.
               The chip, the icons and the priority badge never shrink, and the row never wraps. -->
          <TaskCarryOverDots :day="carryOverDay" />
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <!-- Priority no longer matters once a task is done (#124) -->
          <task-priority-badge
            v-if="isHighPriority && !isDone"
            :priority="HIGH"
          />
        </div>
      </div>
    </template>
  </UCard>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "~/types/task";
import { useI18n } from "vue-i18n";
import { useLocaleFormat } from "~/composables/useLocaleFormat";
import { useBoardStore, DONE_CONFIRMATION_MS } from "~/store/board";
import { useStackExpansion } from "~/composables/useStackExpansion";
import { useSheetSpotlight } from "~/composables/useSheetSpotlight";
import { useBoardDragState } from "~/composables/useBoardDragState";
import TaskProgressChip from "~/components/task/TaskProgressChip.vue";
import TaskCarryOverDots from "~/components/task/TaskCarryOverDots.vue";
import TaskSourceIcon from "~/components/task/TaskSourceIcon.vue";
import TaskTimeboxNudge from "~/components/task/TaskTimeboxNudge.vue";
import { useTasksStore } from "~/store/tasks";
import { useTaskCarryOver } from "~/composables/useCarryOver";
import { useSavePending } from "~/composables/useSavePending";
import { isTaskReturning } from "~/lib/deleteGapState";
import { HIGH, normalizePriority } from "~/lib/priority";
import TaskCompletionBurst from "~/components/task/TaskCompletionBurst.vue";
import TopicMark from "~/components/topic/TopicMark.vue";
import { integrationLabel, isIntegrationSourceId } from "~/lib/taskSources";

defineOptions({ name: "TaskCard" });

const { spotlightTaskId } = useSheetSpotlight();
const { dragState } = useBoardDragState();

const props = withDefaults(
  defineProps<{
    /** Task object containing all task properties and metadata */
    task: Task;
    /** When true, renders the task in a muted visual state */
    muted?: boolean;
    /** True for the drag overlay clone: always renders the standard (non-current) variant */
    preview?: boolean;
    /** Board draft card (#110, #125): standard variant; in Jetzt it shows the running time in the footer; never runs a timer */
    draft?: boolean;
    /** A trash entry (#422): shown as the board shows the task, but it cannot be opened */
    readonly?: boolean;
  }>(),
  {
    muted: false,
    preview: false,
    draft: false,
    readonly: false,
  },
);

const emit = defineEmits<{
  /** Fired once per open gesture, after the stack guards pass. Parents own navigation. */
  open: [id: string];
}>();

const { shouldBlockModal } = useStackExpansion();

/** Carried-over cue (#99): board days this not-done card has stayed on the board. */
const { displayDay: carryOverDay } = useTaskCarryOver(() => props.task);

const computeTaskClass = (): string =>
  "task-" + TaskStatus[props.task.status].toLowerCase();

const taskClass = computed(computeTaskClass);

const computeIsDone = (): boolean => props.task.status === TaskStatus.Done;
const isDone = computed(computeIsDone);

/** Only High gets a badge on the card (#617); a stored 4 (the former urgent) counts as High */
const isHighPriority = computed(() => normalizePriority(props.task.priority) === HIGH);

/**
 * Plays the in-card done confirmation (#124) on the card in Erledigt: a layer inside this card, no
 * second card. A cross-column drop mounts this card fresh in Erledigt (a new instance, as for any
 * move); the flag lives in the board store, so it reaches the new instance.
 */
const boardStore = useBoardStore();
const isConfirming = computed(
  () => isDone.value && !props.preview && boardStore.confirmingTaskIds.includes(props.task.id),
);
/**
 * The corner check springs in once (#611) when the card arrives in Erledigt through a user action: the
 * confirmation flag is on at mount (a drop and a menu move both mount a fresh card in Erledigt) or turns on
 * later. The pop runs longer than the flag, so it is held here until its own animationend; a card
 * that is done on load never sees the flag, so it never pops. A remount inside the 800 ms flag window replays it,
 * as it replays the layer. Under reduced motion no animation runs (no animationend), so the flag is never set.
 */
const prefersReducedMotion = () => import.meta.client && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const checkPopping = ref(isConfirming.value && !prefersReducedMotion());
watch(isConfirming, (on) => {
  if (on && !prefersReducedMotion()) checkPopping.value = true;
});
/** A card that leaves Erledigt (undo mid-pop) never carries the flag back into its next Done */
watch(isDone, (done) => {
  if (!done) checkPopping.value = false;
});
/**
 * Completion burst (#692): plays on the same trigger as the check spring, so on every user completion path and never
 * on load, sync or undo. The store flag ends at 800 ms, the burst runs a little longer and ends itself (`done`), so it
 * has its own flag. Not mounted under reduced motion: the plain completion.
 */
const burstPlaying = ref(isConfirming.value && !prefersReducedMotion());
watch(isConfirming, (on) => {
  if (on && !prefersReducedMotion()) burstPlaying.value = true;
});
watch(isDone, (done) => {
  if (!done) burstPlaying.value = false;
});
/** The layer's animation runs exactly as long as the store flag (one source: DONE_CONFIRMATION_MS) */
const confirmStyle = { "--done-confirm-duration": `${DONE_CONFIRMATION_MS}ms` };

const isInProgress = computed(() => props.task.status === TaskStatus.Progress);
/** A card in Jetzt, except the floating drag preview: the focus overlay measures it (`data-current`) and its chip is the Jetzt bar (#388) */
const isCurrent = computed(() => isInProgress.value && !props.preview && !props.draft);
/** The nudge layer (#389) is up on this Jetzt card: its own content steps back (hidden, still in the DOM) */
const isNudged = computed(
  () => isCurrent.value && !props.task.timeBoxSeconds && boardStore.timeboxNudgeTaskId === props.task.id,
);
/** The Jetzt bar (#388) spans the footer and covers its start group; a chip without a timebox covers nothing */
const barCoversFooter = computed(() => isCurrent.value && !!props.task.timeBoxSeconds);
/** Add-and-start draft (#125): shows the time already running, not the progress chip */
const isJetztDraft = computed(() => props.draft && isInProgress.value);

const { t } = useI18n();

// Cloud icon: unsaved changes while the task's source cannot sync (#319)
const { isSavePending } = useSavePending();
const savePending = computed(() => isSavePending(props.task));
// Source icon (#323): the board decides, so every card of a mixed board has one (Erledigt too), the draft none
const tasksStore = useTasksStore();
const showSourceIcon = computed(() => tasksStore.hasMultipleSources && !props.draft);
const savePendingLabel = computed(() =>
  t('task.savePending', { source: isIntegrationSourceId(props.task.source) ? integrationLabel(props.task.source) : '' }),
);
const { formatDurationParts } = useLocaleFormat();
const elapsedLabel = computed(() => {
  const { value, unit } = formatDurationParts(props.task.timeSpentSeconds, "clockShort");
  return `${value} ${unit}`;
});

/** The chip in Jetzt spans the footer: its measured width is the bar's target (#388) */
const footerEl = ref<HTMLElement | null>(null);
const footerWidth = ref(0);
let footerObserver: ResizeObserver | null = null;

const cardUi = {
  root: "flex flex-col overflow-visible relative",
  body: "font-sans flex-1",
  footer: "",
};

onMounted(() => {
  if (import.meta.client && footerEl.value) {
    const el = footerEl.value;
    footerWidth.value = el.clientWidth;
    if (typeof ResizeObserver !== "undefined") {
      footerObserver = new ResizeObserver(() => { footerWidth.value = el.clientWidth; });
      footerObserver.observe(el);
    }
  }
});

onBeforeUnmount(() => footerObserver?.disconnect());

/**
 * The one open gesture (kd#25): a click, a tap or Enter on the focused card (SortableTaskWrapper dispatches a click with
 * `detail` 0). Nothing opens while a drag runs or when the card's sheet is already open (the second click of a
 * double-click lands on the same card beside the sheet), nor for a card inside a collapsed stack or the rest of the
 * click sequence that expanded one (`shouldBlockModal`). A click with Ctrl, Cmd, Shift or Alt held is not an open: on macOS
 * Ctrl+click is the context menu's gesture, and the others stay free for selection.
 */
const openDetails = (event: MouseEvent) => {
  if (props.readonly || dragState.value.isDragging || spotlightTaskId.value === props.task.id) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = event.currentTarget as HTMLElement;

  if (import.meta.dev) {
    console.log("[TaskCard] openDetails:", {
      taskId: props.task.id,
      stackIndex: target?.dataset.stackIndex,
      hasAttribute: target?.hasAttribute("data-stack-index"),
      shouldBlockModal: shouldBlockModal(event),
      outerHTML: target?.outerHTML.substring(0, 200),
    });
  }

  if (shouldBlockModal(event)) {
    if (import.meta.dev) {
      console.log("[TaskCard] Blocking modal - stack just expanded");
    }
    return;
  }

  if (target?.hasAttribute("data-stack-index")) {
    if (import.meta.dev) {
      console.log("[TaskCard] Blocking modal - card is in collapsed stack");
    }
    return;
  }

  if (import.meta.dev) {
    console.log("[TaskCard] Opening modal - card is not in stack");
  }

  emit("open", props.task.id);
};
</script>

<style scoped>
/* ========================================
   * TASK CORNER (done check)
   * ======================================== */

.task-progress-corner {
  position: absolute;
  top: var(--ui-radius);
  right: var(--ui-radius);
  z-index: 10;
  pointer-events: none;
}

/* Completion burst (#692): every card is its own stacking context (z-index 50), so a later card would paint over the
   pieces that fly into it. While the burst plays this card sits one step above its neighbours. */
.task.task--celebrating {
  z-index: var(--z-card-celebrating);
}

/* ========================================
   * TASK CARD BASE STYLES
   * ======================================== */

.task {
  cursor: pointer;
  user-select: none;
  margin-left: auto;
  margin-right: auto;
  max-height: var(--task-card-height);
  max-width: var(--task-card-max-width);
  width: min(var(--task-card-width), 100%); /* never wider than the column, even at 200% text (#66) */
  text-align: left;
  line-height: var(--lh-snug);
  overflow: visible;
  z-index: var(--z-card);
  transition:
    background-color 160ms var(--ease-emphasized),
    color 160ms var(--ease-emphasized),
    box-shadow var(--duration-fast) var(--ease-standard),
    filter var(--duration-base) var(--ease-emphasized),
    opacity var(--sheet-fade-duration) var(--sheet-fade-easing);
  min-height: var(--task-card-height);
}

.task:not(.kando-dnd-placeholder) {
  box-shadow: var(--shadow-task);
}

/* Hover (kd#25): the card is a click target, so it lifts to the "sheet hovered" shadow under a pointer that can hover.
   Not on a trash entry or the add-sheet draft, not while a drag runs (dnd.css owns the dragged look), and never inside
   a collapsed stack (TaskStack pins its cards to the resting shadow) or on the lit Jetzt card (focus overlay). */
@media (hover: hover) {
  .board:not(.dragging) .task:not(.task--readonly, .task--draft, .kando-dnd-placeholder):hover {
    box-shadow: var(--shadow-task-hover);
  }
}

/* A trash entry (#422) is a picture of the card, not a control */
.task--readonly {
  cursor: default;
}

/* Undo (#422, D6): the card grows back and fades in; transform and opacity only. The gap that held its slot
   disappears at once, so the card lands on the same box. */
.task--returning {
  animation: task-returning 180ms var(--ease-emphasized);
}
@keyframes task-returning {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .task--returning { animation: task-returning-fade 180ms linear; }
  @keyframes task-returning-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
}

/* ========================================
   * TASK STATUS STATES
   * ======================================== */

/* Done (#124): the regular sheet; the struck title recedes through a token colour (Receding Text
   Rule, text-toned ~6:1), teal only on the corner glyph */
.task-done .task-title-text {
  color: var(--ui-text-toned);
  text-decoration: line-through;
}

/* Done (#124, #388): the teal check in the corner, success-700 (4.55:1 on the sheet) */
.task-done-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  color: var(--ui-color-success-700);
}

/* Done check spring (#611): after a user action brought the card into Erledigt, the corner check springs in once.
   It waits for the confirmation layer to start fading out (72.5 % of --done-confirm-duration, as the layer's own
   keyframes) so it lands in the corner as the layer dissolves, instead of playing hidden under it; `backwards`
   keeps it invisible during the wait. The spring is a linear() easing (damping ratio 0.45, ~20 % overshoot,
   settles inside 480 ms) on scale 0.3 -> 1 plus opacity; transform and opacity only, so the card never reflows.
   Compared with `/impeccable live`: B (pop above the layer from the start) showed two checks at once, C (clip-path
   draw with a tilt) was too faint at 20 px. Reduced motion: no animation, the static check. */
.task-done-check--pop {
  animation: done-check-pop 480ms linear(0, 0.117, 0.381, 0.68, 0.935, 1.107, 1.191, 1.202, 1.165, 1.106, 1.047, 0.999, 0.97, 0.958, 0.96, 0.97, 0.982, 0.994, 1.003, 1.007, 1)
    calc(var(--done-confirm-duration) * 0.725) backwards;
}
@keyframes done-check-pop {
  from { opacity: 0; transform: scale(0.3); }
  to { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .task-done-check--pop { animation: none; }
}

/* In-card done confirmation (#124): a light teal layer with a check fades in (180ms), holds (~400ms),
   then fades out (220ms) to reveal the card. Opacity only; the card itself never moves or scales.
   --done-confirm-duration is set inline from DONE_CONFIRMATION_MS (store/board.ts). */
.task-confirm {
  position: absolute;
  inset: 0;
  z-index: 20; /* above the corner glyph */
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--task-card-radius);
  background-color: var(--done-confirm-wash);
  color: var(--ui-color-success-700);
  pointer-events: none;
  opacity: 0;
  animation: task-confirm var(--done-confirm-duration) linear forwards;
}

.task-confirm__icon {
  width: 2.5rem;
  height: 2.5rem;
}

@keyframes task-confirm {
  0% {
    opacity: 0;
    animation-timing-function: var(--ease-emphasized);
  }
  22.5% { /* 180ms */
    opacity: 1;
  }
  72.5% { /* hold ~400ms */
    opacity: 1;
    animation-timing-function: var(--ease-standard);
  }
  100% { /* 220ms out */
    opacity: 0;
  }
}

/* Reduced motion: no layer at all, the done state confirms (#136: no toast on drag; the only
   reduced-motion switch for the confirmation; the store flag is set either way) */
@media (prefers-reduced-motion: reduce) {
  .task-confirm {
    display: none;
  }
}

.task-progress:not(.kando-dnd-placeholder) {
  background-color: var(--task-card-progress-bg);
}

/* ========================================
   * TASK INTERACTION STATES
   * ======================================== */

.task.muted,
.task-waiting {
  filter: grayscale(var(--task-muted-filter-grayscale))
    brightness(var(--task-muted-filter-brightness))
    contrast(var(--task-muted-filter-contrast));
  /* Same colour and shadow easing as the `.task` base rule: this list replaces it, so leaving them out made the hover
     shadow of a Wartet card snap instead of ease (#147) */
  transition:
    background-color var(--duration-fast) var(--ease-emphasized),
    color var(--duration-fast) var(--ease-emphasized),
    box-shadow var(--duration-fast) var(--ease-standard),
    filter var(--task-muted-transition-duration) var(--task-muted-transition-easing),
    opacity var(--sheet-fade-duration) var(--sheet-fade-easing);
}

/* Muted text steps down to a token colour instead of fading with opacity, so the
   contrast stays predictable (WCAG 1.4.3): toned title ~6:1, topic stays text-muted. */
.task.muted .task-title-text,
.task-waiting .task-title-text {
  color: var(--ui-text-toned);
  transition: color var(--task-muted-transition-duration)
    var(--task-muted-transition-easing);
}

.task.muted:hover .task-title-text,
.task.muted:focus-within .task-title-text,
.task-waiting:hover .task-title-text,
.task-waiting:focus-within .task-title-text {
  color: var(--ui-text);
}

/* ========================================
   * DRAG & DROP STATES
   * ======================================== */

/**
  * NOTE: Drag/grab/drag styles are defined globally in assets/css/main.css
  * Do NOT override them here to avoid specificity conflicts
  */

/* ========================================
   * TASK STACK INTEGRATION
   * ======================================== */

.task.stacked-task--overflow {
  transition:
    transform var(--stack-transition-duration, 220ms)
      var(--stack-transition-easing, var(--ease-standard)),
    box-shadow var(--stack-transition-duration, 220ms)
      var(--stack-transition-easing, var(--ease-standard)),
    opacity var(--stack-transition-duration, 220ms)
      var(--stack-transition-easing, var(--ease-standard)),
    background-color 160ms var(--ease-emphasized),
    color 160ms var(--ease-emphasized);
}

/* ========================================
   * TASK CONTENT ELEMENTS
   * ======================================== */

.task-title-text {
  margin: 0;
  line-height: var(--lh-snug);
  word-wrap: break-word;
  overflow-wrap: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Default: assume topic is present */
  max-height: calc(var(--task-card-height) - 2rem);
  -webkit-line-clamp: 4;
  line-clamp: 4;
}

.task:not(:has(.task-topic)) .task-title-text {
  max-height: calc(var(--task-card-height) - 1rem);
  -webkit-line-clamp: 5;
  line-clamp: 5;
}

.task:has(.task-footer:not(:empty)) .task-title-text {
  max-height: calc(var(--task-card-height) - 4rem);
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

.task:has(.task-footer:not(:empty)):not(:has(.task-topic)) .task-title-text {
  max-height: calc(var(--task-card-height) - 2.75rem);
  -webkit-line-clamp: 4;
  line-clamp: 4;
}

.task-title-text:hover {
  max-height: none;
  -webkit-line-clamp: unset;
  line-clamp: unset;
  overflow: visible;
}

/* ========================================
   * RESPONSIVE TYPOGRAPHY & MOBILE SIZING
   * ======================================== */

@media (--phone) {
  /* Mobile type step (#220, A1): card text 1rem, topic and footer labels 0.9375rem / 0.75rem.
     Explicit sizes only; the root font-size stays untouched. */
  .task {
    font-size: var(--text-base);
    min-height: 8rem;
    max-height: none;
  }

  .task-topic {
    font-size: var(--text-title);
  }

  .task-draft-elapsed {
    font-size: var(--text-title);
  }

  /* Footer chips (timebox, priority): Nuxt UI sets their size per utility class, so the
     scoped rule reaches the child root through :deep */
  .task-footer :deep([data-slot="base"]) {
    font-size: var(--text-xs);
    line-height: 1rem;
  }

  .task-title-text {
    -webkit-line-clamp: 6;
    line-clamp: 6;
    max-height: none;
  }

  .task:has(.task-footer:not(:empty)) .task-title-text,
  .task:has(.task-footer:not(:empty)):not(:has(.task-topic)) .task-title-text {
    -webkit-line-clamp: 4;
    line-clamp: 4;
    max-height: none;
  }
}

@media (--desktop) {
  .task {
    font-size: var(--text-title);
  }
}

/* ========================================
   * JETZT CARD (#394): a regular card, no size, radius, title or padding change (it was the large "current"
   * variant of #93). The focus comes from the board's overlay (FocusOverlay.vue); `data-current` is what it
   * measures. Its progress is the chip in the footer (TaskProgressChip, #388).
   * ======================================== */

/* The footer is the chip's positioning context: in Jetzt the chip spans its width, over the left group */
.task-footer {
  position: relative;
  min-height: 1.75rem;
}
</style>
