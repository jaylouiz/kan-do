<!--
@component TrashEntryRow
@description One deleted task in the trash (#422): the board's own card, read-only, with when it was deleted, where it was and the actions.
@usage Rendered by pages/trash.vue (every entry, restore and remove-forever)
@responsibility
- Shows the standard TaskCard (`readonly`, `preview`: no sheet, no drag, no swipe, no task id on the DOM); a Wartet card is muted as on the board
- "Gelöscht vor …", "War in <Spalte>" ("War in Jetzt, kommt zurück nach Offen" for a task from Jetzt) beside the card on desktop, below it at 390px
- "Wiederherstellen: <title>" for every entry; "Endgültig löschen: <title>" on the page only (`forever`), the sheet is a one-action surface
- A failed restore leaves the entry where it is (`useTrash` reports the error)
-->
<template>
  <div class="trash-entry" data-testid="trash-entry" :data-trash-id="entry.taskId">
    <TaskCard :task="entry.task" :muted="entry.fromStatus === TaskStatus.Waiting" preview readonly class="trash-entry__card" />
    <div class="trash-entry__side">
      <p class="text-sm text-muted">{{ agoLabel }}</p>
      <p class="text-sm text-muted" data-testid="trash-was-in">{{ wasInLabel }}</p>
      <div class="trash-entry__actions">
        <UButton
          icon="i-ph-arrow-counter-clockwise"
          color="neutral"
          variant="soft"
          :loading="isRestoring(entry.taskId)"
          :aria-label="t('trash.restoreNamed', { title: entry.task.title })"
          data-testid="trash-restore"
          @click="emit('restore', entry.taskId)"
        >
          {{ t('trash.restore') }}
        </UButton>
        <UButton
          v-if="forever"
          icon="i-ph-x"
          color="neutral"
          variant="ghost"
          :aria-label="t('trash.removeForeverNamed', { title: entry.task.title })"
          data-testid="trash-remove"
          @click="emit('remove', entry.taskId)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
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
/* Desktop: card, then meta and actions beside it; 390px: below it (the wrap breaks before the side column gets narrow) */
.trash-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem 1rem;
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
.trash-entry__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.5rem;
}
</style>
