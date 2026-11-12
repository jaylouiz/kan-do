<!--
@component TaskStack
@kind compound
@category display
@description A collapsed stack of task cards in a grouped column: front card, peek layers, pill
@usage Used by BoardColumn for a group of 2+ tasks while it is collapsed. Expanding is declarative
  (#147): BoardColumn stops rendering the stack and renders the group's members as ordinary cards,
  behind a TaskStackHeader (#148).
@avoid Only a collapsed stack of 2+ tasks; an expanded group renders its members through BoardColumnItem.
@responsibility
- Shows the group as a front card (the first task) with `min(count - 1, 2)` peek layers behind it
  (`--stack-layers`, step `--stack-collapsed-offset`), and the details as a split capsule (TaskStackPill, #504:
  grouping property | stack icon + count) centred on the front card, whose content is muted (#195, #371)
- The collapsed face (cards, layers, pill) is one unit, so a whole-stack drag (#150) moves all of it
- Is ONE dnd-kit sortable (#150): its id is the front task's id (that card is inert, so the id is
  unique), its data carries the stack (key, label, taskIds). Dropping it moves every member; the
  column and useBoardDndKit read the members from the data. The stack root is the sortable element
  (it includes the pill), the control is its handle
- Is one keyboard stop: a role=button control named "<front title>, <group>, <n> Aufgaben", with aria-expanded; Enter and
  click ask the column to expand (`expand`), Space picks the whole stack up (dnd-kit's keyboard
  sensor), like a card. Its role description and instructions are stack-specific
- Keeps its cards inert: they are neither focusable nor read out, the control is the only way in
- Applies the data attributes the board reads (data-task-id = front card, data-stack-task-ids)
- `preview`: the face as it rests, for the DragOverlay: no control, no sortable, no click
- Marks its root `kando-dnd-dragged` while it is the drag source: assets/css/dnd.css turns it into
  one grey slot of the stack's footprint (front card greyed, layers and pill invisible)
- Its members become individual sortables once the column expands the group (#147)
-->
<template>
  <div
    ref="element"
    class="task-stack"
    :class="[{
      'task-stack--preview': preview,
      'kando-dnd-dragged': isDragging,
    }, preview ? null : dropMotionClasses]"
    :style="{ '--stack-layers': layers }"
    :data-stack-key="preview ? undefined : stackKey"
    :data-stack-size="tasks.length"
    :data-task-id="preview ? undefined : topCardId"
    :data-stack-task-ids="preview ? undefined : stackTaskIdsAttr"
    :aria-hidden="preview ? 'true' : undefined"
    @click="!preview && emit('expand', 'pointer', $event)"
  >
    <!-- The one control of the stack, and the sortable's handle. A sibling of the cards, not their
         container: axe's label-in-name rule (WCAG 2.5.3) would demand the cards' visible text in a
         button's name. Its name is "<front title>, <group>, <n> Aufgaben" (no middle dot): it holds the
         front card's visible title and the caption text, so voice control can say either (WCAG 2.5.3).
         Enter expands; Space is dnd-kit's (pick up). -->
    <template v-if="!preview">
      <span
        ref="control"
        class="task-stack__control"
        role="button"
        tabindex="0"
        :aria-label="accessibleName"
        aria-expanded="false"
        :aria-roledescription="t('board.dnd.stackRoleDescription')"
        :aria-describedby="descriptionId"
        @keydown.enter="onEnter"
      />
      <span :id="descriptionId" hidden>{{ t("board.dnd.stackInstructions") }}</span>
    </template>
    <!-- The shadow filter lives on the cards only, so it never touches the caption text -->
    <div class="task-stack__cards">
      <task-card
        v-for="(task, index) in tasks"
        :key="task.id"
        :task="task"
        :muted="muted"
        :preview="preview"
        :class="getCardClasses(index)"
        :style="getCardStyles(index)"
        :data-stack-index="index"
        inert
      />
    </div>
    <!-- Visual only: the control carries the accessible name -->
    <div class="task-stack__pill-layer" :class="{ 'task-stack__pill-layer--toned': washToned }" aria-hidden="true">
      <task-stack-pill class="task-stack__caption" :group-key="stackKey" :label="label" :count="tasks.length" :first-task="tasks[0]" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { useColumnSortable } from "~/composables/useColumnSortable";
import { useDropMotionClasses } from "~/composables/useDropMotion";
import TaskCard from "~/components/task/TaskCard.vue";
import TaskStackPill from "~/components/task/TaskStackPill.vue";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "~/types/task";
import { stackAccessibleName } from "~/utils/stackAccessibleName";

defineOptions({ name: "TaskStack" });

/**
 * Component props
 * @property {string} stackKey - Unique grouping identifier (e.g., priority value)
 * @property {Task[]} tasks - Ordered list of tasks contained in this stack
 * @property {boolean} [muted] - Render cards in muted style when true
 * @property {string} label - Readable group name for the caption and the accessible name
 * @property {TaskStatus} taskStatus - Column the stack sits in (the sortable's group)
 * @property {number} sortableIndex - Index among the column's sortables (the stack counts once)
 * @property {boolean} [preview] - Resting face for the DragOverlay: no control, no sortable
 */
const props = defineProps<{
  /** Unique grouping identifier (e.g., priority value) */
  stackKey: string;
  /** Ordered list of tasks contained in this stack */
  tasks: Task[];
  /** Render cards in muted style when true */
  muted?: boolean;
  /** Readable group name for the caption and the accessible name */
  label: string;
  /** Column the stack sits in (the sortable's group) */
  taskStatus: TaskStatus;
  /** Index among the column's sortables: the stack counts once, by its front task */
  sortableIndex: number;
  /** Resting face for the DragOverlay: no control, no sortable */
  preview?: boolean;
}>();

/** The front card is filtered when muted or in Wartet (TaskCard.vue); the wash follows it */
const washToned = computed(() => props.muted === true || props.tasks[0]?.status === TaskStatus.Waiting);

const emit = defineEmits<{
  /**
   * Click, tap or Enter on the stack; `source` tells the column where focus should go. A click passes
   * its event, so the column can tell the click that ends a drag from a deliberate one (by identity).
   */
  expand: [source: "pointer" | "keyboard", event?: MouseEvent];
}>();

/** Peek layers behind the front card: one per further task, never more than two */
const MAX_PEEK_LAYERS = 2;

const topCardId = computed(() => props.tasks[0]?.id ?? "");
const stackTaskIdsAttr = computed(() => JSON.stringify(props.tasks.map((task) => task.id)));
const layers = computed(() => Math.min(Math.max(props.tasks.length - 1, 0), MAX_PEEK_LAYERS));
const { t } = useI18n();
const accessibleName = computed(() =>
  stackAccessibleName(t, { frontTitle: props.tasks[0]?.title, group: props.label, count: props.tasks.length }),
);

/**
 * Enter expands once. A held key repeats: the stack is gone after the first keydown, so the repeats
 * land on the first member (SortableTaskWrapper ignores them there) and must not expand again.
 */
function onEnter(event: KeyboardEvent) {
  event.preventDefault();
  if (event.repeat) return;
  emit("expand", "keyboard");
}

// ---- Whole-stack drag (#150) ----
const element = ref<HTMLElement | null>(null);
const control = ref<HTMLElement | null>(null);
const descriptionId = `task-stack-description-${useId()}`;
const stackData = computed(() => ({
  stack: { key: props.stackKey, label: props.label, taskIds: props.tasks.map((task) => task.id) },
}));
// The overlay's resting face is not a drop target: it never registers. `preview` is fixed per instance.
const sortable = props.preview
  ? null
  : useColumnSortable(
    () => topCardId.value,
    computed(() => props.sortableIndex),
    props.taskStatus,
    element,
    { data: stackData, handle: control },
  );
const isDragging = computed(() => sortable?.isDragging.value ?? false);
const dropMotionClasses = useDropMotionClasses(() => topCardId.value);

function getCardClasses(index: number): Record<string, boolean> {
  return {
    "stacked-task": true,
    "stacked-task--top": index === 0,
    "stacked-task--overflow": index > 0,
    "stacked-task--hidden": index > layers.value,
  };
}

function getCardStyles(index: number): Record<string, string> {
  return {
    "--stack-index": `${index}`,
    "--stack-z": `${400 - index}`,
  };
}
</script>

<style scoped>
/* ========================================
 * TASK STACK (#148)
 * The collapsed face is front card + peek layers + pill, all driven by --stack-layers (0-2) and
 * --stack-collapsed-offset (4px). No rotation; hover and focus only lift the front card.
 * ======================================== */

.task-stack {
  position: relative;
  /* no min-height, tasks in the stack have a height */
  /* Centering within task-list */
  max-width: var(--task-stack-max-width);
  width: min(var(--task-stack-width), 100%); /* follows the column down like a card (#641) */
  margin-inline: auto;
  /* no bottom margin (#195): the list's own gap is the space below, as for a plain card */
}

/** Cards: room below the front card for the peek layers; carries the stack shadow */
.task-stack__cards {
  position: relative;
  padding-bottom: calc(var(--stack-layers, 0) * var(--stack-collapsed-offset));
}

.task-stack:not(.kando-dnd-placeholder) .task-stack__cards {
  filter: var(--shadow-stack-collapsed);
  transition: filter var(--stack-transition-duration) var(--stack-transition-easing);
}

/** Hover/Focus: the shadow follows the lifted front card */
.task-stack:not(.kando-dnd-placeholder):hover .task-stack__cards,
.task-stack:not(.kando-dnd-placeholder):focus-within .task-stack__cards {
  filter: var(--shadow-stack-hover);
}

/**
 * Pill (#195, #371): a layer over the whole front card (above its --stack-z, below the control, so
 * it never takes a pointer event). The pill is centred on both axes of the card, not in a free
 * strip: the card's content behind it is muted (below), so overlapping a title line is accepted.
 */
.task-stack__pill-layer {
  position: absolute;
  inset: 0 0 calc(var(--stack-layers, 0) * var(--stack-collapsed-offset)) 0;
  z-index: var(--z-stack-pill);
  isolation: isolate; /* the wash's z-index -1 stays inside this layer */
  display: grid;
  place-items: center;
  pointer-events: none;
  transition: transform var(--stack-transition-duration) var(--stack-transition-easing);
}

/**
 * Wash (#270, #371): the pill sits on a wide radial wash of the card's sheet colour, opaque at the
 * centre and transparent toward the ellipse edge, covering most of the front card (clipped to it),
 * so the pill reads as lying above the card, not belonging to it.
 */
.task-stack__pill-layer::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: var(--task-card-radius);
  background: radial-gradient(
    ellipse var(--stack-wash-rx) var(--stack-wash-ry) at center,
    var(--ui-bg-elevated) var(--stack-wash-opaque),
    transparent var(--stack-wash-edge)
  );
}

/** The wash tones with a muted or waiting front card, like the card's own filter (TaskCard.vue) */
.task-stack__pill-layer--toned::before {
  filter: grayscale(var(--task-muted-filter-grayscale))
    brightness(var(--task-muted-filter-brightness))
    sepia(var(--task-muted-filter-sepia))
    contrast(var(--task-muted-filter-contrast));
}

/** The pill follows the front card's hover/focus lift */
.task-stack:hover .task-stack__pill-layer,
.task-stack:focus-within .task-stack__pill-layer {
  transform: translateY(-2px);
}

/**
 * The control covers the stack so every press lands on it. Its keyboard focus ring goes on the
 * front card, so it follows the card's own shape.
 */
.task-stack__control {
  position: absolute;
  inset: 0;
  z-index: var(--z-stack-control); /* above every card's --stack-z */
  border-radius: var(--task-card-radius);
  cursor: pointer;
}

.task-stack__control:focus-visible {
  outline: none;
}

.task-stack__control:focus-visible ~ .task-stack__cards :deep(.stacked-task--top) {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

/**
 * Muted front card (#371, user decision, reverses #270/#282): the content of the front card of a
 * collapsed stack steps back, so the pill reads as the stack's face. Low contrast here is accepted
 * (recorded here, exempted in a11y.spec.ts): it only signals that cards are stacked. The card's
 * sheet, shadow and focus ring stay; expanded members and plain cards never get this.
 */
.task-stack__cards :deep(.stacked-task--top > *) {
  opacity: var(--stack-front-content-opacity);
  transition: opacity var(--stack-transition-duration) var(--stack-transition-easing);
}

/** Cards in a stack keep their standard shadow */
.task-stack :deep(.task) {
  box-shadow: var(--shadow-task) !important;
}

/* ========================================
 * STACKED CARD POSITIONING
 * ======================================== */

/**
 * Front card is in flow, defines the stack's height. Hover and focus lift it a little.
 * - z-index: board.css gives every `.task` z-index 100 + --item-index, which is far below the
 *   peek cards' --stack-z (399). Without this the second task covers the first one.
 */
:deep(.stacked-task--top) {
  position: relative;
  z-index: var(--stack-z, auto);
  transition: transform var(--stack-transition-duration) var(--stack-transition-easing);
}

.task-stack:hover :deep(.stacked-task--top),
.task-stack:focus-within :deep(.stacked-task--top) {
  transform: translateY(-2px);
}

/**
 * Peek layers: absolutely positioned behind the front card, one offset step lower and narrower per
 * layer, so only a sliver of each shows. They are inert and never move (the front card does).
 */
:deep(.stacked-task--overflow) {
  position: absolute;
  top: 0;
  left: calc(var(--stack-index) * var(--stack-collapsed-offset));
  right: calc(var(--stack-index) * var(--stack-collapsed-offset));
  width: auto;
  z-index: var(--stack-z, auto);
  transform: translateY(calc(var(--stack-index) * var(--stack-collapsed-offset)));
  pointer-events: none;
}

/** Cards beyond the layers are not shown */
:deep(.stacked-task--hidden) {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .task-stack__cards,
  .task-stack__pill-layer,
  .task-stack__cards :deep(.stacked-task--top > *),
  :deep(.stacked-task--top) {
    transition: none;
  }
}
</style>
