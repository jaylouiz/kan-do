<!--
@component DayCloseTaskRow
@kind component
@category display
@description One task done today in the closing sheet (#98, #237, a `ListRow`): title, a subline ("Erledigt", plus how the time compares with the timebox) and the time spent at the end.
@usage <DayCloseTaskRow :task="task" /> inside a <ul class="divide-y divide-default"> (renders a ListRow, an <li>). Not draggable, not a link, no buttons.
@avoid Not a board card (TaskCard) and not an open task: those are DayCloseOpenRow with a checkbox.
@responsibility
- Subline: "Erledigt" and, when the task has a timebox and tracked time, "In der Timebox" / "n Min unter der Timebox" / "n Min über der Timebox" (`timeBoxFact`, 5 minutes apart is still in the timebox)
- The time spent at the end (hidden without tracked time); the title wraps and is masked in feedback screenshots
-->
<template>
  <ListRow data-testid="day-close-done-row" :data-task-id="task.id">
    <div class="min-w-0 flex-1 basis-40">
      <p class="text-sm wrap-break-word text-default" data-private>{{ task.title }}</p>
      <p class="text-xs text-muted" data-testid="day-close-done-subline">{{ subline }}</p>
    </div>
    <span v-if="task.timeSpentSeconds > 0" class="shrink-0 text-sm text-toned tabular-nums" data-testid="day-close-done-time">
      {{ formatDuration(task.timeSpentSeconds, 'spaced') }}
    </span>
  </ListRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ListRow from '~/components/ui/ListRow.vue'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { timeBoxFact } from '~/utils/dayClose'
import type { Task } from '~/types/task'

defineOptions({ name: 'DayCloseTaskRow' })

interface Props {
  task: Task
}

const props = defineProps<Props>()

const { t } = useI18n()
const { formatDuration } = useLocaleFormat()

const fact = computed(() => {
  const { state, minutes } = timeBoxFact(props.task)
  if (state === 'none') return ''
  return t(`dayClose.box.${state}`, { n: minutes })
})
const subline = computed(() => [t('dayClose.rowDone'), fact.value].filter(Boolean).join(' · '))
</script>
