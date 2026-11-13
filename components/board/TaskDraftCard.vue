<!--
@component TaskDraftCard
@kind component
@category display
@description Representative card for the task being added in the sheet (#110): empty and white at first, fills live as the form is filled in
@usage Rendered by AddTaskSlot in the same box as the add button while `useTaskDraft` has a draft for that column (Offen, or Jetzt for add-and-start, #125)
@avoid Not a saved task (TaskCard); shown only while a task draft exists in the add slot.
@responsibility
- Reuses TaskCard for the layout so the draft matches the saved card (regular size; in Jetzt it shows the running time)
- Not interactive, not draggable, not part of the tasks store
- Looks like a normal card; the spotlight (#96/#102) fades the other cards while the draft is open
-->
<template>
  <div
    v-if="draftTask"
    ref="rootEl"
    class="task-draft"
    role="group"
    :aria-label="t('board.draftCard')"
    data-testid="task-draft-card"
  >
    <task-card :task="draftTask" draft />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import TaskCard from '~/components/task/TaskCard.vue';
import { useTaskDraft } from '~/composables/useTaskDraft';
import { isPhoneNow } from '~/composables/useIsDesktop';
import { revealDraft } from '~/utils/revealDraft';

defineOptions({ name: 'TaskDraftCard' });

const { t } = useI18n();
const { draftTask } = useTaskDraft();
const rootEl = ref<HTMLElement | null>(null);

// On mobile the sheet covers the lower half of the board: bring the draft (at the start of its list) into the visible part.
onMounted(() => {
  if (!import.meta.client) return;
  const mobile = isPhoneNow();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  revealDraft(rootEl.value, { phone: mobile, reducedMotion: reduced });
});
</script>

<style scoped>
.task-draft {
  width: 100%;
  max-width: var(--task-card-width);
  margin: 0 auto;
  border-radius: var(--task-card-radius);
  /* The card is a visual stand-in: no hover, click or double-click behaviour */
  pointer-events: none;
  /* Morph (#125): the card sheet fades in over the add slot in the same box; nothing scales or moves */
  animation: task-draft-in var(--task-transform-duration) var(--ease-standard);
}

@keyframes task-draft-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .task-draft {
    animation: none;
  }
}
</style>
