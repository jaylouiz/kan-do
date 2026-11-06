<!--
@component TaskDetailTimeStats
@description Time block of the task sheet: one line "spent · remaining" with the timebox ring.
             No card nesting, no empty state (the parent renders it only when there is time data).
@usage Used in TaskDetailContent
@responsibility
- Shows time spent and, with a timebox, the remaining time and the progress ring
- The timebox value itself lives in the Timebox property row
- Handles the warning tint for low or used-up remaining time
-->
<template>
  <div class="flex items-center gap-3" data-testid="time-stats-data">
    <TaskProgressCircular
      v-if="task.timeBoxSeconds"
      :time-box-seconds="task.timeBoxSeconds"
      :time-spent-seconds="task.timeSpentSeconds"
      :is-running="!!task.timerId"
      :size="32"
      :stroke-width="3"
      :show-label="false"
      :is-done="task.status === TaskStatus.Done"
    />
    <p class="text-sm tabular-nums">
      <span>{{ t('task.timeStats.spent', { time: timeSpentText }) }}</span>
      <template v-if="task.timeBoxSeconds">
        <span class="text-muted" aria-hidden="true"> · </span>
        <span :class="remainingTimeClass">{{ t('task.timeStats.remaining', { time: remainingTimeText }) }}</span>
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Task } from '~/types/task';
import { TaskStatus } from '~/types/taskStatus';
import TaskProgressCircular from '~/components/task/TaskProgressCircular.vue';

defineOptions({ name: 'TaskDetailTimeStats' });

const { t } = useI18n();

const props = defineProps<{
  /** The task object containing time data */
  task: Task;
  /** Formatted string for time spent (e.g. "30 min") */
  timeSpentText: string;
  /** Formatted string for remaining time (e.g. "30 min") */
  remainingTimeText: string;
}>();

const remainingTimeClass = computed(() => {
  if (!props.task.timeBoxSeconds) return '';
  const remaining = props.task.timeBoxSeconds - (props.task.timeSpentSeconds ?? 0);
  const percentage = (remaining / props.task.timeBoxSeconds) * 100;
  if (percentage <= 0) return 'text-warning-700 font-semibold';
  if (percentage <= 20) return 'text-warning-700 font-medium';
  return '';
});
</script>
