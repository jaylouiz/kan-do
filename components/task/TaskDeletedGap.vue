<!--
@component TaskDeletedGap
@description The slot of a card that was just deleted (#422, UX decision D "Im Papierkorb"): the card's own box, with
a trash icon, "Im Papierkorb", a "Rückgängig" pill and a short draining line centered in it, all in raspberry on a muted
raspberry shape (#581; destructive state, The Status Is Not Decoration Rule). Nothing below it moves.
@usage Rendered by BoardColumn / BoardColumnProgressContent at the card's slot, from `useTaskDeletion().gaps`; never inside
SortableTaskWrapper (a gap is no dnd-kit sortable: not draggable, not droppable, no sheet).
@responsibility
- Holds the slot at the card's measured height for the undo window; the card itself is already out of `tasks`
- D6 transition: a non-interactive picture of the card (TaskCard `readonly`, `inert`) shrinks to 0.92 and fades out towards its
  own centre in 220 ms (ease-out) while the answer layer fades in over the same time; transform and opacity only
- Red theme (#581): the box carries a muted shape (`::before`: card radius, 6% `error` wash over the page, hairline `error` border at
  30%) that fades in with the answer layer (220 ms, opacity only; it clips away with the closing glide). Label and trash icon are
  `error-700`, the undo pill is `color="error" variant="soft"` (the global compound in `app.config.ts` sets `error-700` text, #594),
  the drain line is `error-500` (a graphic, 3:1 needed)
- Drain line: 5 s `scaleX` 1 -> 0, linear; paused with the window while the pointer or focus is inside the gap (two flags, resumed when both are off; resumed on unmount too, `useDeleteHold`)
- Window end (`state: 'closing'`): the box glides shut in 280 ms (grid row 1fr -> 0fr, the list gap's negative margin
  included) and focus moves to the next card, or the list when it was the last, if it was in or lost with the gap
- `prefers-reduced-motion`: the picture only crossfades (no scale), the drain line is static, the gap closes without gliding
- Contrast: "Im Papierkorb" and the pill text are `error-700` on the wash measured 7.0:1 (label) and 6.2:1 (pill, on its own tint); the `error-500` drain line is 4.2:1 on the wash (a graphic needs 3:1)
-->
<template>
  <div
    ref="element"
    class="task-gap"
    :class="{ 'task-gap--closing': gap.state === 'closing' }"
    :data-gap-id="gap.taskId"
    :style="{ '--gap-height': gap.height === null ? undefined : `${gap.height}px`, '--gap-drain': `${DELETE_UNDO_WINDOW_MS}ms` }"
    role="group"
    :aria-label="t('trash.gapLabel', { title: gap.task.title })"
    @pointerenter="hold(gap.taskId, 'pointer', true)"
    @pointerleave="hold(gap.taskId, 'pointer', false)"
    @focusin="hold(gap.taskId, 'focus', true)"
    @focusout="onFocusOut(gap.taskId, $event)"
  >
    <div class="task-gap__clip">
      <div class="task-gap__box">
        <TaskCard :task="gap.task" preview readonly class="task-gap__picture" aria-hidden="true" inert />
        <div class="task-gap__answer">
          <p class="task-gap__label">
            <UIcon name="i-ph-trash" class="size-5 shrink-0" aria-hidden="true" />
            {{ t('trash.inTrash') }}
          </p>
          <UButton
            size="sm"
            color="error"
            variant="soft"
            class="rounded-full"
            :disabled="gap.state === 'closing'"
            :aria-label="t('trash.undoNamed', { title: gap.task.title })"
            data-testid="gap-undo"
            @click="undoDelete(gap.taskId)"
          >
            {{ t('common.undo') }}
          </UButton>
        </div>
        <span
          class="task-gap__drain"
          :class="{ 'task-gap__drain--paused': gap.paused }"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from '~/components/task/TaskCard.vue'
import { useDeleteHold } from '~/composables/useDeleteHold'
import { DELETE_UNDO_WINDOW_MS, useTaskDeletion } from '~/composables/useTaskDeletion'
import type { DeletedGap } from '~/types/deletedGap'
import { focusFirstAvailable } from '~/utils/focusRecovery'

defineOptions({ name: 'TaskDeletedGap' })

const props = defineProps<{
  gap: DeletedGap
}>()

const { t } = useI18n()
const { undoDelete } = useTaskDeletion()
const { hold, onFocusOut } = useDeleteHold()
const element = ref<HTMLElement | null>(null)

/** The window is over: focus that sat in the gap, or was lost with the card, goes on to the next card. */
watch(() => props.gap.state, (state) => {
  if (state !== 'closing') return
  const gapEl = element.value
  const active = document.activeElement
  if (!gapEl || (active && active !== document.body && !gapEl.contains(active))) return
  const list = gapEl.parentElement
  let next = gapEl.nextElementSibling
  while (next && !next.matches('.task-wrapper, .task-stack')) next = next.nextElementSibling
  focusFirstAvailable([
    () => (next as HTMLElement | null),
    () => list,
    () => list?.closest<HTMLElement>('.column')?.querySelector<HTMLElement>('h2') ?? null,
  ])
})
</script>

<style scoped>
/* The gap's box is the card's box: same width rules as .task, height as measured at delete time. */
.task-gap {
  display: grid;
  grid-template-rows: 1fr;
  margin-left: auto;
  margin-right: auto;
  width: min(var(--task-card-width), 100%);
  max-width: var(--task-card-max-width);
  transition:
    grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1),
    margin-bottom 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Closing: the box glides to zero height and takes the list's gap (--task-list-gap) with it (nothing jumps afterwards). */
.task-gap--closing {
  grid-template-rows: 0fr;
  margin-bottom: calc(-1 * var(--task-list-gap));
  pointer-events: none;
}

.task-gap__clip {
  min-height: 0;
  /* overflow hidden only matters while the row closes; the picture's shadow is gone by then */
  overflow: hidden;
}

.task-gap__box {
  position: relative;
  height: var(--gap-height, var(--task-card-height));
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Red theme (#581): the muted raspberry shape of the card's box; opacity-only fade-in with the answer layer. It comes first in
   the box and has no z-index, so the picture and the z-indexed answer paint over it, and the box opens no stacking context of its
   own (an `isolation` here let the Jetzt column's drop zone cover the undo pill) */
.task-gap__box::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--task-card-radius);
  background-color: color-mix(in oklab, var(--ui-color-error-500) 6%, var(--ui-bg));
  border: 1px solid color-mix(in oklab, var(--ui-color-error-500) 30%, transparent);
  animation: task-gap-answer-in 220ms cubic-bezier(0, 0, 0.2, 1) both;
}

/* D6: the picture of the card shrinks and fades towards its own centre; it never takes part in layout */
.task-gap .task-gap__picture {
  position: absolute;
  inset: 0;
  margin: 0;
  width: 100%;
  max-width: none;
  pointer-events: none;
  animation: task-gap-picture-out 220ms cubic-bezier(0, 0, 0.2, 1) forwards;
}
@keyframes task-gap-picture-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.92); }
}

.task-gap__answer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0 0.75rem;
  animation: task-gap-answer-in 220ms cubic-bezier(0, 0, 0.2, 1) both;
}
@keyframes task-gap-answer-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.task-gap--closing .task-gap__answer {
  opacity: 0;
  transition: opacity 140ms linear;
}

.task-gap__label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  font-weight: 500;
  color: var(--ui-color-error-700);
}

/* The draining line sits under the answer, centred in the slot (D "Im Papierkorb") */
.task-gap__drain {
  position: absolute;
  left: 50%;
  bottom: calc(50% - 1.75rem);
  width: 8rem;
  margin-left: -4rem;
  height: 2px;
  background-color: var(--ui-color-error-500);
  transform-origin: center;
  animation: task-gap-drain var(--gap-drain) linear forwards;
}
.task-gap__drain--paused {
  animation-play-state: paused;
}
@keyframes task-gap-drain {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .task-gap { transition: none; }
  .task-gap__picture { animation: task-gap-picture-fade 220ms linear forwards; }
  @keyframes task-gap-picture-fade {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  .task-gap__drain { animation: none; }
}
</style>
