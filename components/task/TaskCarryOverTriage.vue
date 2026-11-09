<!--
@component TaskCarryOverTriage
@kind component
@category action
@description Calm triage block for a card carried over CARRY_OVER_NUDGE_DAYS or more board days (#99):
"Still here after N days." with Keep, Make smaller and Delete.
@usage <TaskCarryOverTriage :task-id="id" @smaller="focusTitle" @delete="deleteTask" />
`compact` for list rows that already show the dots (#98): actions only, no wash, no heading, and a quiet look (all three
ghost, #551; the task sheet block too, #552) so the block never outweighs the primary of the surface that lists it.
Standalone so the closing step (#98) can list it under "still open". Renders nothing when no nudge is due
(fewer days, kept recently, Wartet or Erledigt).
@avoid Only on cards carried over several days; not a general card menu (TaskCardContextMenu).
@responsibility
- Keep: silences the nudge for CARRY_OVER_NUDGE_DAYS further days (store), the dots keep counting
- Make smaller / Delete: emitted, the host owns the title field and the sheet lifecycle
- Delete copy names the upstream consequence (Notion, Todoist)
-->
<template>
  <section
    v-if="isNudgeDue"
    class="carry-over-triage"
    :class="compact ? undefined : 'rounded-lg bg-muted/50 px-4 py-3'"
    :aria-labelledby="compact ? undefined : headingId"
    :aria-label="compact ? title : undefined"
    :data-compact="compact ? '' : undefined"
    data-testid="carry-over-triage"
  >
    <template v-if="!compact">
      <div class="flex items-center gap-2">
        <TaskCarryOverDots :day="displayDay" decorative />
        <h3 :id="headingId" class="text-sm font-medium text-highlighted">{{ title }}</h3>
      </div>
      <p class="mt-1 text-sm text-muted">{{ t('task.carryOver.nudgeHint') }}</p>
    </template>
    <div class="flex flex-wrap items-center gap-2" :class="{ 'mt-3': !compact }">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="ph:push-pin"
        data-testid="carry-over-keep"
        @click="handleKeep"
      >
        {{ t('task.carryOver.keep') }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="ph:arrows-in-simple"
        data-testid="carry-over-smaller"
        @click="emit('smaller')"
      >
        {{ t('task.carryOver.smaller') }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="ph:trash"
        :ui="{ leadingIcon: 'text-error' }"
        data-testid="carry-over-delete"
        @click="emit('delete')"
      >
        {{ deleteLabel }}
      </UButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { deleteLabelKey } from '~/lib/taskSources'
import { useTaskCarryOver } from '~/composables/useCarryOver'
import TaskCarryOverDots from '~/components/task/TaskCarryOverDots.vue'

defineOptions({ name: 'TaskCarryOverTriage' })

interface Props {
  /** Task to triage. */
  taskId: string
  /**
   * Embedded in a list row that already shows the dots (#98 closing step): no wash, no heading,
   * only the three actions in a group named by the nudge sentence.
   */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), { compact: false })

const emit = defineEmits<{
  /** The user chose Keep (nudge silenced). */
  kept: []
  /** The user wants a smaller first step: the host focuses the title field. */
  smaller: []
  /** The user chose Delete: the host runs the shared upstream-aware delete. */
  delete: []
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()
const headingId = useId()

const { displayDay, isNudgeDue, keep } = useTaskCarryOver(() => tasksStore.task(props.taskId))

const title = computed(() => t('task.carryOver.nudgeTitle', { n: displayDay.value }))

const deleteLabel = computed(() => t(deleteLabelKey(tasksStore.task(props.taskId)?.source ?? 'local')))

const handleKeep = () => {
  keep()
  emit('kept')
}
</script>
