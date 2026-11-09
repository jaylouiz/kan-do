<!--
@component DayCloseBody
@description Scrolling content of the closing step (#98): what got done today, what is not done yet, one closing line.
@usage Hosted by DayCloseDialog (modal and drawer share it). Reads the local cache only; a sync that lands while it is open updates the lists in place.
@responsibility
- Recap line and the quiet list of tasks completed today with their time (no archived, nothing from earlier days)
- "Noch nicht erledigt": Offen, Jetzt and Wartet as plain rows (not draggable, not links), carry-over dots, the #99 triage block (compact) for Offen/Jetzt past the threshold
- One muted line under the list when something is in Jetzt: "Fertig" puts it back to Offen (the move itself lives in useDayClose.finish)
- Closing line chosen by local date
- Emits `smaller` so the host can close and open the task sheet; Delete goes through useTaskDeletion. The board's gap sits behind the modal, so a deleted row is answered here by one line ("Im Papierkorb", "Rückgängig") until its window ends (#422)
-->
<template>
  <div class="flex flex-col gap-8" data-testid="day-close-body">
    <section :aria-labelledby="doneHeadingId" data-testid="day-close-done">
      <h3 :id="doneHeadingId" class="font-display text-headline text-muted">{{ t('dayClose.doneHeading') }}</h3>
      <p class="mt-1 text-sm text-toned" data-testid="day-close-recap">{{ recap }}</p>
      <ul
        v-if="done.length > 0"
        class="mt-3 flex flex-col gap-2"
        :aria-label="t('dayClose.doneListLabel', { n: done.length }, done.length)"
      >
        <li
          v-for="task in done"
          :key="task.id"
          class="flex items-start gap-2 text-sm text-toned"
          data-testid="day-close-done-row"
        >
          <UIcon name="i-ph-check" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 wrap-break-word" data-private>{{ task.title }}</span>
          <span v-if="task.timeSpentSeconds > 0" class="shrink-0 text-muted tabular-nums">
            {{ formatDuration(task.timeSpentSeconds, 'spaced') }}
          </span>
        </li>
      </ul>
    </section>

    <section :aria-labelledby="inFlightHeadingId" data-testid="day-close-in-flight">
      <h3 :id="inFlightHeadingId" class="font-display text-headline text-muted">{{ t('dayClose.inFlightHeading') }}</h3>
      <p v-if="inFlight.length === 0 && rowGaps.length === 0" class="mt-1 text-sm text-toned">{{ t('dayClose.nothingInFlight') }}</p>
      <ul
        v-else
        class="mt-3 flex flex-col gap-4"
        :aria-label="t('dayClose.inFlightListLabel', { n: inFlight.length }, inFlight.length)"
      >
        <DayCloseTaskRow
          v-for="task in inFlight"
          :key="task.id"
          :task="task"
          @smaller="emit('smaller', task.id)"
        />
        <!-- A delete from this dialog (#422): the board's gap sits behind the modal, so the row answers here, same copy -->
        <li
          v-for="gap in rowGaps"
          :key="gap.taskId"
          class="flex items-center gap-3 text-sm text-toned"
          data-testid="day-close-deleted-row"
          @pointerenter="hold(gap.taskId, 'pointer', true)"
          @pointerleave="hold(gap.taskId, 'pointer', false)"
          @focusin="hold(gap.taskId, 'focus', true)"
          @focusout="onFocusOut(gap.taskId, $event)"
        >
          <UIcon :name="ICONS.delete" class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 wrap-break-word">{{ t('trash.inTrash') }}</span>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            class="shrink-0 rounded-full"
            :aria-label="t('trash.undoNamed', { title: gap.task.title })"
            @click="undoDelete(gap.taskId)"
          >
            {{ t('common.undo') }}
          </UButton>
        </li>
      </ul>
      <p v-if="progress.length > 0" class="mt-4 text-sm text-muted" data-testid="day-close-put-back-hint">{{ putBackHint }}</p>
    </section>

    <p class="text-lg text-highlighted" data-testid="day-close-closing-line">{{ closingLine }}</p>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDayCloseData } from '~/composables/useDayClose'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { closingLineIndex } from '~/utils/dayClose'
import { localDateKey } from '~/utils/carryOver'
import DayCloseTaskRow from '~/components/board/DayCloseTaskRow.vue'
import { useDeletedGaps } from '~/composables/useDeletedGaps'
import { useDeleteHold } from '~/composables/useDeleteHold'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { TaskStatus } from '~/types/taskStatus'

defineOptions({ name: 'DayCloseBody' })

const emit = defineEmits<{
  /** The user chose "Make smaller" on a card: the host closes the dialog and opens the task sheet. */
  smaller: [taskId: string]
}>()

const { t } = useI18n()
const { formatDuration } = useLocaleFormat()
const { done, totalSeconds, inFlight, progress } = useDayCloseData()
const { undoDelete } = useTaskDeletion()
const { hold, onFocusOut } = useDeleteHold()
const { gaps } = useDeletedGaps()
/** Deletes inside their undo window that came from a row of this list (not from Erledigt) */
const rowGaps = computed(() => gaps.value.filter(gap => gap.state === 'open' && gap.fromStatus !== TaskStatus.Done))

const doneHeadingId = useId()
const inFlightHeadingId = useId()

const recap = computed(() => {
  if (done.value.length === 0) return t('dayClose.nothingDone')
  return totalSeconds.value > 0
    ? t('dayClose.recap', { n: done.value.length, time: formatDuration(totalSeconds.value, 'spaced') })
    : t('dayClose.recapNoTime', { n: done.value.length })
})

const putBackHint = computed(() =>
  t('dayClose.putBackHint', { title: progress.value[0]?.title ?? '', n: progress.value.length }, progress.value.length),
)

// Captured when the dialog mounts (it mounts on open): stable while it is open, even across midnight.
const closingLineKey = `dayClose.closing.line${closingLineIndex(localDateKey())}`
const closingLine = computed(() => t(closingLineKey))
</script>
