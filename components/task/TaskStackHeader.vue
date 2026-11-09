<!--
@component TaskStackHeader
@description Header row of an expanded stack: the stack's pill as its title and a round close button (#578)
@usage Rendered by BoardColumnItem in front of the members of an expanded group (#148)
@responsibility
- The pill is the same TaskStackPill the collapsed face shows, centred over the card column: on expand it
  rises from the face to this row, on collapse it sinks back (useStackMotion), so it is one object that
  moves and never vanishes. Same width cap in both places (94 % of the column, property segment 10rem):
  nothing here may squeeze it, the close button is positioned outside its width
- The round X at the row's right edge asks the column to collapse the group (click, Enter, Space); the
  column returns focus to the stack, as it does for Escape. Its accessible name is "Gruppe <group>
  schließen" (no aria-expanded: it is an action). 24px round, same soft grey as the pill, the add-task
  button and the app bar's ⋯ (`--ui-bg-muted`, no ring); on hover the pointer cursor and one neutral step darker (`--ui-color-neutral-300`: `--ui-bg-accented` is the same value as `--ui-bg-muted` here, so it showed nothing, kd#55); 44px hit area on touch
- The root is a role=group named by the stack caption text; it is not a sortable and carries no
  data-task-id: dnd-kit and the drop mapping never see it
- Row min-height 2rem (2.75rem on touch widths)
-->
<template>
  <div
    class="task-stack-header"
    role="group"
    :aria-label="caption"
    :data-stack-header="groupKey"
  >
    <task-stack-pill
      class="task-stack-header__pill"
      :group-key="groupKey"
      :label="label"
      :count="count"
      :first-task="firstTask"
    />
    <u-button
      class="task-stack-header__close"
      color="neutral"
      variant="ghost"
      size="xs"
      square
      icon="i-ph-x"
      :aria-label="t('board.stack.closeLabel', { group: label })"
      @click="(event: MouseEvent) => emit('close', event.detail === 0 ? 'keyboard' : 'pointer')"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import TaskStackPill from "~/components/task/TaskStackPill.vue";
import { useStackCaption } from "~/composables/useStackCaption";
import type { Task } from "~/types/task";

defineOptions({ name: "TaskStackHeader" });

const props = defineProps<{
  /** Group key (matches `data-stack-key` of the collapsed stack and `data-from-stack` of the members) */
  groupKey: string;
  /** Readable group name */
  label: string;
  /** Number of tasks in the group */
  count: number;
  /** The group's front task: the pill's topic mark reads its topic and source */
  firstTask?: Task | undefined;
}>();

const emit = defineEmits<{
  /** Round X: collapse the group; a click with detail 0 is Enter or Space on the button */
  close: [source: "pointer" | "keyboard"];
}>();

const { t } = useI18n();
/** The group's name for assistive tech: the same text the old caption showed */
const caption = useStackCaption(() => props.label, () => props.count);
</script>

<style scoped>
/* Same width and centring as a card; the pill sits centred over the card column exactly as on the collapsed face */
.task-stack-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(var(--task-stack-width), 100%); /* follows the column down like a card (#641) */
  max-width: var(--task-stack-max-width);
  min-height: 2rem;
  margin-inline: auto;
}

.task-stack-header__pill {
  position: relative; /* the motion lifts it above the cards while it travels */
  flex: 0 1 auto;
  pointer-events: none; /* decorative, as on the face: a tap during the rise reaches the card below */
}

/* Round close at the right edge, outside the pill's width (never squeezes it); soft grey like the pill */
.task-stack-header__close {
  position: absolute;
  inset-inline-end: 0;
  top: 50%;
  margin-top: -0.75rem;
  width: 1.5rem;
  height: 1.5rem;
  min-width: 1.5rem;
  padding: 0;
  justify-content: center;
  border-radius: 9999px;
  background-color: var(--ui-bg-muted);
  color: var(--ui-text);
  cursor: pointer;
}

/* `--ui-bg-accented` equals `--ui-bg-muted` in this theme (main.css), so the hover reads the next neutral step */
.task-stack-header__close:hover {
  background-color: var(--ui-color-neutral-300);
}

@media (max-width: 767px) {
  .task-stack-header {
    min-height: 2.75rem;
  }

  /* 44px hit area around the 24px round button */
  .task-stack-header__close::after {
    content: "";
    position: absolute;
    inset: -0.625rem;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .task-stack-header__close {
    transition: background-color 120ms ease;
  }
}
</style>
