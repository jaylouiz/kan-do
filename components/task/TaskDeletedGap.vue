<!--
@component TaskDeletedGap
@kind component
@category feedback
@description The slot of a card that was just deleted (#422, UX decision D "Im Papierkorb"): the card's own box, with
a trash icon, "Im Papierkorb" and a "Rückgängig" button centred in it (a `BoardColumnNotice` with `tone="trash"`, #293: the same strip and button shape as the yesterday note; the content stays centred, unlike the note's label-left action-right line, because the drain line and the fading card picture are centred on the box), all in raspberry on a muted raspberry fill without an
outline (#581, #57; destructive state, The Status Is Not Decoration Rule), and a draining line along its bottom edge. From #57 the
gap is compact (`--task-note-height`, the collapsed Yesterday note's height: 48px, 56px at 390px): the cards below glide up by the difference and back on undo.
@usage Rendered by BoardColumn / BoardColumnProgressContent at the card's slot, from `useTaskDeletion().gaps`; never inside
SortableTaskWrapper (a gap is no dnd-kit sortable: not draggable, not droppable, no sheet).
@avoid Only the slot of a just-deleted card with undo; never inside a drag list.
@responsibility
- Holds a compact slot (`--task-note-height`: 48px, 56px at 390px) for the undo window, for a card and a stack alike; the box glides from the card's measured height (`--gap-from`) to it in 220 ms; the card itself is already out of `tasks`
- D6 transition: a non-interactive picture of the card (TaskCard `readonly`, `inert`) shrinks to 0.92 and fades out towards its
  own centre in 220 ms (ease-out) while the answer layer fades in over the same time; transform and opacity only
- Red theme (#581, outline dropped #57): the box carries a muted shape (BoardColumnNotice's `::before`: card radius, 12% `error` wash over the page, no border) that fades in with the answer layer (220 ms, opacity only; it clips away with the closing glide). Label and trash icon are
  `error-700`, the undo button is the notice's action, `color="error" variant="soft"` in the default 12 px radius, no pill (the global compound in `app.config.ts` sets `error-700` text, #594),
  the drain line is `error-500` (a graphic, 3:1 needed)
- Drain line: 2px, full width at the bottom edge (clipped to the radius), 5 s `scaleX` 1 -> 0 from the left, linear; paused with the window while the pointer or focus is inside the gap (two flags, resumed when both are off; resumed on unmount too, `useDeleteHold`)
- Window end (`state: 'closing'`): the box glides shut in 280 ms (grid row 1fr -> 0fr, the list gap's negative margin
  included) and focus moves to the next card, or the list when it was the last, if it was in or lost with the gap
- `prefers-reduced-motion`: the picture only crossfades (no scale), the drain line is static, the gap closes without gliding
- Contrast: "Im Papierkorb" and the button text are `error-700` on the 12% wash (earlier figures were measured on 6%; re-measure with the rendered Impeccable scan `npm run design:detect`); the `error-500` drain line is a graphic and needs 3:1
-->
<template>
  <div
    ref="element"
    class="task-gap"
    :class="{ 'task-gap--closing': gap.state === 'closing' }"
    :data-gap-id="gap.taskId"
    :style="{ '--gap-from': gap.height === null ? undefined : `${gap.height}px`, '--gap-drain': `${DELETE_UNDO_WINDOW_MS}ms` }"
    role="group"
    :aria-label="t('trash.gapLabel', { title: gap.task.title })"
    @pointerenter="hold(gap.taskId, 'pointer', true)"
    @pointerleave="hold(gap.taskId, 'pointer', false)"
    @focusin="hold(gap.taskId, 'focus', true)"
    @focusout="onFocusOut(gap.taskId, $event)"
  >
    <div class="task-gap__clip">
      <BoardColumnNotice
        class="task-gap__box"
        tone="trash"
        :action-label="t('common.undo')"
        :action-aria-label="t('trash.undoNamed', { title: gap.task.title })"
        action-test-id="gap-undo"
        :action-disabled="gap.state === 'closing'"
        @action="undoDelete(gap.taskId)"
      >
        <template #backdrop>
          <TaskCard :task="gap.task" preview readonly class="task-gap__picture" aria-hidden="true" inert />
        </template>
        <p class="task-gap__label">
          <UIcon :name="ICONS.delete" class="size-5 shrink-0" aria-hidden="true" />
          {{ t('trash.inTrash') }}
        </p>
        <template #overlay>
          <span
            class="task-gap__drain"
            :class="{ 'task-gap__drain--paused': gap.paused }"
            aria-hidden="true"
          />
        </template>
      </BoardColumnNotice>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from '~/components/task/TaskCard.vue'
import BoardColumnNotice from '~/components/board/BoardColumnNotice.vue'
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
/* The gap's box has the card's width rules (as .task); its height is the compact note height. */
.task-gap {
  display: grid;
  grid-template-rows: 1fr;
  margin-left: auto;
  margin-right: auto;
  width: min(var(--task-card-width), 100%);
  max-width: var(--task-card-max-width);
  --gap-h: var(--gap-from, var(--task-card-height));
  transition:
    grid-template-rows 280ms var(--ease-standard),
    margin-bottom 280ms var(--ease-standard);
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

/* The box is a BoardColumnNotice (#293): surface, minimum height (compact, #57: the collapsed Yesterday note's height), radius and
   the undo button come from it. It glides there from the card's measured height while the picture fades, so the column
   closes up with the picture instead of jumping. min-height, not height: when the label and the button wrap (large text, zoom)
   the box grows instead of clipping the button. */
.task-gap__box {
  --notice-line-justify: center;
  --notice-line-wrap: wrap;
  --notice-line-gap: 0.75rem;
  overflow: hidden;
  animation: task-gap-shrink 220ms cubic-bezier(0, 0, 0.2, 1) backwards;
}
@keyframes task-gap-shrink {
  from { height: var(--gap-h); }
  to { height: var(--task-note-height); }
}

/* Red theme (#581): the muted raspberry shape is the notice's wash (`::before`, no z-index, no stacking context: an `isolation`
   there let the Jetzt column's drop zone cover the undo pill); it fades in with the answer layer, opacity only */
.task-gap__box::before {
  animation: task-gap-answer-in 220ms cubic-bezier(0, 0, 0.2, 1) both;
}

/* D6: the picture of the card shrinks and fades towards its own centre; it never takes part in layout */
.task-gap .task-gap__picture {
  position: absolute;
  top: 50%;
  left: 0;
  height: var(--gap-h);
  margin: calc(var(--gap-h) / -2) 0 0;
  width: 100%;
  max-width: none;
  pointer-events: none;
  animation: task-gap-picture-out 220ms cubic-bezier(0, 0, 0.2, 1) forwards;
}
@keyframes task-gap-picture-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.92); }
}

.task-gap__box :deep(.notice__line) {
  animation: task-gap-answer-in 220ms cubic-bezier(0, 0, 0.2, 1) both;
}
@keyframes task-gap-answer-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.task-gap--closing .task-gap__box :deep(.notice__line) {
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

/* The draining line runs along the bottom edge like the toast's timer line (#57); the box clips it to the corner radius */
.task-gap__drain {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background-color: var(--ui-color-error-500);
  transform-origin: left;
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
  .task-gap__box { animation: none; }
  .task-gap__picture { animation: task-gap-picture-fade 220ms linear forwards; }
  @keyframes task-gap-picture-fade {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  .task-gap__drain { animation: none; }
}
</style>
