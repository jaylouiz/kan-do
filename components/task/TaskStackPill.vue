<!--
@component TaskStackPill
@kind primitive
@category display
@description The face of a collapsed stack's pill (#504): one split capsule, "<property> | <stack icon> <n>"
@usage Inside the aria-hidden pill layer of a collapsed TaskStack, centred on the front card
@avoid Only the face of a collapsed stack's pill inside TaskStack.
@responsibility
- Left segment names the grouping property the way a card shows it: topic = TopicMark + neutral name (hue only on
  the mark); priority 1-3 = the real TaskPriorityBadge as the segment itself (no hairline after it); activity,
  custom/Notion value and the empty group = the plain name
- Right segment is the stack icon (`i-ph-stack`) and the count; it never shrinks, a large count widens it only
- The property segment is capped at 10rem and is cut in the middle (`MiddleEllipsis`, kd#119: stacks of "Karriere: Bewerbung" and
  "Karriere: Weiterbildung" stay apart; the cap is a look decision, tune here); the full
  name stays in the stack control's accessible name, so there is no tooltip. The pill is decorative: the
  visible word "Aufgaben" is gone, the control still says it
- Soft neutral like the former text pill (`--fill-on-canvas`, label role 500 / 0.6875rem, 0.75rem on touch), 1.5rem
  high, fully rounded outer shape, a 1px hairline between the segments
- Never takes a pointer event (its layer is `pointer-events: none`)
-->
<template>
  <span class="task-stack-pill" :data-prop-kind="kind">
    <span class="task-stack-pill__prop" :class="{ 'task-stack-pill__prop--priority': kind === 'priority' }">
      <task-priority-badge v-if="kind === 'priority'" :priority="Number(groupKey)" size="sm" />
      <template v-else>
        <topic-mark v-if="kind === 'topic'" :topic="firstTask?.topic" :task="firstTask" />
        <MiddleEllipsis class="task-stack-pill__text" :text="label" data-private />
      </template>
    </span>
    <span class="task-stack-pill__count">
      <u-icon name="i-ph-stack" class="task-stack-pill__icon" />
      <span data-private>{{ count }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import TopicMark from "~/components/topic/TopicMark.vue";
import MiddleEllipsis from "~/components/ui/MiddleEllipsis.vue";
import TaskPriorityBadge from "~/components/task/TaskPriorityBadge.vue";
import { useBoardGrouping } from "~/composables/useBoardGrouping";
import { PRIORITY_LABEL_KEYS } from "~/utils/taskStatusMappings";
import { EMPTY_GROUP_KEY } from "~/utils/taskGrouping";
import type { Task } from "~/types/task";

defineOptions({ name: "TaskStackPill" });

const props = defineProps<{
  /** Group key of the stack (priority level, topic name, ...) */
  groupKey: string;
  /** Readable group name (the plain-name fallback and the topic's name) */
  label: string;
  /** Number of tasks in the stack */
  count: number;
  /** The stack's front task: the topic mark reads its topic and source */
  firstTask?: Task | undefined;
}>();

const { effectiveGroupKey } = useBoardGrouping();

/** How the property segment is drawn */
const kind = computed<"topic" | "priority" | "plain">(() => {
  if (props.groupKey === EMPTY_GROUP_KEY) return "plain";
  if (effectiveGroupKey.value === "topic") return "topic";
  if (effectiveGroupKey.value === "priority" && Number(props.groupKey) in PRIORITY_LABEL_KEYS) return "priority";
  return "plain";
});
</script>

<style scoped>
/* Label role (DESIGN.md "Type"): 500, 0.6875rem, 1rem; text on the canvas fill as the former text pill */
.task-stack-pill {
  display: inline-flex;
  align-items: center;
  max-width: 94%;
  min-width: 0;
  overflow: hidden;
  border-radius: 9999px;
  font-size: var(--text-label);
  font-weight: 500;
  line-height: 1rem;
  color: var(--ui-text);
}

/* Mobile label step (#220): 0.6875rem -> 0.75rem, matching the card footer chips */
@media (--phone) {
  .task-stack-pill {
    font-size: var(--text-xs);
  }
}

.task-stack-pill__prop,
.task-stack-pill__count {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  background-color: var(--fill-on-canvas);
  white-space: nowrap;
}

/* Property: shrinks first, capped at 10rem (160px); MiddleEllipsis cuts the name */
.task-stack-pill__prop {
  min-width: 0;
  max-width: 10rem;
  padding-inline: 0.625rem 0.5rem;
}

.task-stack-pill__text {
  min-width: 0;
}

/* Count: never shrinks; the hairline separates it from the property */
.task-stack-pill__count {
  flex: none;
  gap: 0.25rem;
  padding-inline: 0.5rem 0.625rem;
  border-inline-start: 1px solid var(--ui-border-accented);
  font-variant-numeric: tabular-nums;
}

.task-stack-pill__icon {
  width: 0.875rem;
  height: 0.875rem;
}

/* The priority badge is the segment itself: its own tint, no extra padding, no hairline after it */
.task-stack-pill__prop--priority {
  padding: 0;
  background: none;
}

.task-stack-pill__prop--priority :deep(.priority) {
  height: 1.5rem;
  padding-inline: 0.625rem;
  border-radius: 0;
  font-size: inherit;
}

.task-stack-pill__prop--priority + .task-stack-pill__count {
  border-inline-start: 0;
}
</style>
