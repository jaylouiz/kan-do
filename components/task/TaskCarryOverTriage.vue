<!--
@component TaskCarryOverTriage
@kind component
@category action
@description Triage block for a card carried over CARRY_OVER_NUDGE_DAYS or more board days (#99). Task sheet (#247): one sentence
with the day count and two soft buttons ("Ja, behalten" / "Nein, löschen"); after Keep it becomes a confirmation (check icon, status
role, tip). `compact` (day-close rows): Keep, Make smaller and Delete as quiet ghost buttons.
@usage <TaskCarryOverTriage :task-id="id" @smaller="focusTitle" @delete="deleteTask" />
`compact` for list rows that already show the dots (#98): actions only, no wash, no heading, and a quiet look (all three
ghost, #551) so the block never outweighs the primary of the surface that lists it.
Standalone so the closing step (#98) can list it under "still open". Renders nothing when no nudge is due
(fewer days, kept recently, Wartet or Erledigt).
@avoid Only on cards carried over several days; not a general card menu (TaskCardContextMenu).
@responsibility
- Keep: silences the nudge for CARRY_OVER_NUDGE_DAYS further days (store), the dots keep counting
- Make smaller (compact only, the day-close route to the sheet's smaller-step title edit) / Delete: emitted, the host owns the title field and the sheet lifecycle
- Sheet Delete ("Nein, löschen") and the compact Delete both run the host's one confirmed delete; the compact label names the upstream consequence (Notion, Todoist)
- The kept confirmation lives in the component (`kept`), so it outlasts `isNudgeDue` turning false while the sheet is open
-->
<template>
  <section
    v-if="isNudgeDue || kept"
    class="carry-over-triage"
    :class="compact ? undefined : 'rounded-lg bg-muted/50 px-4 py-3'"
    :aria-labelledby="compact || kept ? undefined : headingId"
    :aria-label="compact ? title : undefined"
    :data-compact="compact ? '' : undefined"
    data-testid="carry-over-triage"
  >
    <!-- Task sheet: one question, two answers (#247); the status region stays in the DOM so the confirmation is announced -->
    <template v-if="!compact">
      <div role="status" data-testid="carry-over-kept-status">
        <div v-if="kept" class="flex items-start gap-2.5" data-testid="carry-over-kept">
          <UIcon name="i-ph-check-circle" class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p class="text-body font-medium text-highlighted">{{ t('task.carryOver.kept') }}</p>
            <p class="mt-1 text-body text-muted">{{ t('task.carryOver.keptTip') }}</p>
          </div>
        </div>
      </div>
      <template v-if="!kept">
        <p :id="headingId" class="text-body text-highlighted">{{ t('task.carryOver.question', { n: displayDay }, displayDay) }}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-ph-check"
            data-testid="carry-over-keep"
            @click="handleKeep"
          >
            {{ t('task.carryOver.keepYes') }}
          </UButton>
          <UButton
            color="error"
            variant="soft"
            :icon="ICONS.delete"
            data-testid="carry-over-delete"
            @click="emit('delete')"
          >
            {{ t('task.carryOver.deleteNo') }}
          </UButton>
        </div>
      </template>
    </template>

    <!-- Compact (day-close rows): the three quiet actions, unchanged -->
    <div v-else class="flex flex-wrap items-center gap-2">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-ph-push-pin"
        data-testid="carry-over-keep"
        @click="handleKeep"
      >
        {{ t('task.carryOver.keep') }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-ph-arrows-in-simple"
        data-testid="carry-over-smaller"
        @click="emit('smaller')"
      >
        {{ t('task.carryOver.smaller') }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :icon="ICONS.delete"
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
import { ICONS } from '~/lib/icons'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { deleteLabelKey } from '~/lib/taskSources'
import { useTaskCarryOver } from '~/composables/useCarryOver'

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

/** The sheet's box turns into the confirmation after Keep and stays while the sheet is open (not persisted) */
const kept = ref(false)

const handleKeep = () => {
  keep()
  if (!props.compact) kept.value = true
  emit('kept')
}
</script>
