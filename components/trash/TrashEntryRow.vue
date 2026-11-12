<!--
@component TrashEntryRow
@kind component
@category display
@description One deleted task in the trash (#422): the board's own card, read-only, with when it was deleted, where it was and the actions.
@usage Rendered by pages/trash.vue (every entry, restore and remove-forever)
@avoid Only a deleted task on the trash page; live tasks are TaskCard.
@responsibility
- Shows the standard TaskCard (`readonly`, `preview`: no sheet, no drag, no swipe, no task id on the DOM); a Wartet card is muted as on the board
- "Gelöscht vor …", "War in <Spalte>" ("War in Jetzt, kommt zurück nach Offen" for a task from Jetzt) beside the card on desktop with the actions below them; on a phone below the card, the two lines left and both actions right in the same band, no wider than the card (kd#216)
- "Wiederherstellen: <title>" for every entry (soft neutral; icon-only on a phone, the name stays its accessible name); "Endgültig löschen: <title>" on the page only (`forever`): an icon button in the soft error tone, so the destructive action is told apart at a glance (kd#216, owner). Two soft buttons side by side are allowed in a row of two (DESIGN.md "Components")
- The trash button asks in place (kd#21, aligned with "Papierkorb leeren"): question, "Endgültig löschen", "Abbrechen" (focused); Esc or Abbrechen returns focus to it. On a phone the question takes the full width below the two lines
- Its own stacking context (`isolation`): a card carries `--z-card` (50) for the board, which outside the board would put it above the app bar (40) while it scrolls under it (kd#225)
- A failed restore leaves the entry where it is (`useTrash` reports the error)
-->
<template>
  <div class="trash-entry" data-testid="trash-entry" :data-trash-id="entry.taskId">
    <TaskCard :task="entry.task" :muted="entry.fromStatus === TaskStatus.Waiting" preview readonly class="trash-entry__card" />
    <div class="trash-entry__side" :class="{ 'is-confirming': forever && confirming }">
      <div class="trash-entry__meta">
        <p class="text-sm text-muted">{{ agoLabel }}</p>
        <p class="text-sm text-muted">{{ wasInLabel }}</p>
      </div>
      <div class="trash-entry__actions" @keydown.esc.stop="confirming && cancel()">
        <UButton
          icon="i-ph-arrow-counter-clockwise"
          color="neutral"
          variant="soft"
          class="max-md:min-w-11 max-md:justify-center max-md:gap-0 max-md:px-0"
          :loading="isRestoring(entry.taskId)"
          :aria-label="t('trash.restoreNamed', { title: entry.task.title })"
          @click="emit('restore', entry.taskId)"
        >
          <span class="max-md:hidden">{{ t('trash.restore') }}</span>
        </UButton>
        <template v-if="forever && confirming">
          <p class="trash-entry__confirm text-body text-default" role="alert" data-private>
            {{ t('trash.removeForeverConfirm', { title: entry.task.title }) }}
          </p>
          <UButton color="error" variant="soft" data-testid="trash-remove-confirm" @click="confirmRemove">
            {{ t('trash.emptyConfirmYes') }}
          </UButton>
          <UButton
            ref="cancelBtn"
            color="neutral"
            variant="ghost"
            data-testid="trash-remove-cancel"
            @click="cancel"
          >
            {{ t('common.cancel') }}
          </UButton>
        </template>
        <UButton
          v-else-if="forever"
          ref="removeBtn"
          :icon="ICONS.delete"
          color="error"
          variant="soft"
          :aria-label="t('trash.removeForeverNamed', { title: entry.task.title })"
          @click="openConfirm"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from '~/components/task/TaskCard.vue'
import { useTrash } from '~/composables/useTrash'
import { trashAgo } from '~/lib/trash'
import { TaskStatus } from '~/types/taskStatus'
import type { TrashEntry } from '~/types/trash'

defineOptions({ name: 'TrashEntryRow' })

const props = defineProps<{
  entry: TrashEntry
  /** The page also offers remove-forever; the sheet does not */
  forever?: boolean
}>()

const emit = defineEmits<{
  restore: [taskId: string]
  remove: [taskId: string]
}>()

const { t } = useI18n()
const { isRestoring } = useTrash()

// Remove-forever asks in place (kd#21): focus to "Abbrechen", Esc / Abbrechen put it back on the ✕
const confirming = ref(false)
const cancelBtn = ref<{ $el: HTMLElement } | null>(null)
const removeBtn = ref<{ $el: HTMLElement } | null>(null)

const openConfirm = async () => {
  confirming.value = true
  await nextTick()
  cancelBtn.value?.$el.focus()
}
const cancel = async () => {
  confirming.value = false
  await nextTick()
  removeBtn.value?.$el.focus()
}
const confirmRemove = () => {
  confirming.value = false
  emit('remove', props.entry.taskId)
}

const COLUMN_KEY: Record<number, string> = {
  [TaskStatus.Open]: 'open',
  [TaskStatus.Progress]: 'progress',
  [TaskStatus.Waiting]: 'waiting',
  [TaskStatus.Done]: 'done',
}

const agoLabel = computed(() => {
  const ago = trashAgo(props.entry.deletedAt, Date.now())
  return ago.unit === 'now' ? t('trash.ago.now') : t(`trash.ago.${ago.unit}`, { n: ago.n }, ago.n)
})

const wasInLabel = computed(() =>
  props.entry.fromStatus === TaskStatus.Progress
    ? t('trash.wasInProgress')
    : t('trash.wasIn', { column: t(`board.columns.${COLUMN_KEY[props.entry.fromStatus] ?? 'open'}`) }),
)
</script>

<style scoped>
/* Desktop: card, then meta and actions beside it; phone: below it (the wrap breaks before the side column gets narrow) */
.trash-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem 1rem;
  /* The card's z-index (50, for the board) stays inside the entry: outside the board it would lie above the app bar */
  isolation: isolate;
}

.trash-entry :deep(.task) {
  margin-left: 0;
  margin-right: 0;
}

.trash-entry__side {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 11rem;
  flex: 1 1 11rem;
  padding-top: 0.25rem;
}

.trash-entry__meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.trash-entry__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

/* Phone (kd#216): one band below the card and as wide as it, the two lines left, both actions right. The in-place
   question needs the width, so it drops below the lines. */
@media (--phone) {
  .trash-entry__side {
    flex: 1 1 100%;
    flex-flow: row wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    max-width: var(--task-card-max-width); /* the card's own cap on a phone (board.css) */
    padding-top: 0;
  }

  .trash-entry__meta {
    flex: 1 1 0;
    padding-top: 0.125rem;
  }

  .trash-entry__actions {
    flex: none;
    flex-wrap: nowrap;
    margin-top: 0;
  }

  .trash-entry__side.is-confirming .trash-entry__actions {
    flex: 1 1 100%;
    flex-wrap: wrap;
  }
}
</style>
