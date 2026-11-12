<!--
@component DayCloseTaskRow
@kind component
@category display
@description One "not done yet" row in the closing step (#98, a `ListRow` since kd#180): title, column label, carry-over dots, and the optional triage actions.
@usage <DayCloseTaskRow :task="task" @smaller="..." /> inside a <ul class="divide-y divide-default"> (renders a ListRow, an <li>). Not draggable, not a link.
@avoid Not a board card (TaskCard) and not draggable or a link; only the "not done yet" rows of the closing step.
@responsibility
- Show the column label (Offen, Jetzt, Wartet) and the #99 dots when the card has been carried over
- Offen/Jetzt past the #99 threshold: TaskCarryOverTriage in `compact` mode; Wartet never (the block renders nothing there)
- Delete goes through useTaskDeletion (upstream-aware, undo in the row's place, see DayCloseBody); Make smaller is emitted to the host
-->
<template>
  <ListRow class="flex-col items-stretch gap-y-2" data-testid="day-close-in-flight-row" :data-task-id="task.id">
    <div class="flex items-start gap-2 text-sm">
      <span class="min-w-0 flex-1 wrap-break-word text-default" data-private>{{ task.title }}</span>
      <TaskCarryOverDots :day="displayDay" class="mt-0.5 shrink-0" />
      <span class="shrink-0 text-muted" data-testid="day-close-column">{{ columnLabel }}</span>
    </div>
    <TaskCarryOverTriage
      :task-id="task.id"
      compact
      @smaller="emit('smaller')"
      @delete="deleteTaskWithUndo(task.id)"
    />
  </ListRow>
</template>

<script setup lang="ts">
import ListRow from '~/components/ui/ListRow.vue'
import { computed } from 'vue'
import type { Task } from '~/types/task'
import { getStatusLabel } from '~/utils/taskStatusMappings'
import { useTaskCarryOver } from '~/composables/useCarryOver'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import TaskCarryOverDots from '~/components/task/TaskCarryOverDots.vue'
import TaskCarryOverTriage from '~/components/task/TaskCarryOverTriage.vue'

defineOptions({ name: 'DayCloseTaskRow' })

interface Props {
  task: Task
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** "Make smaller" was chosen in the triage block. */
  smaller: []
}>()

const { deleteTaskWithUndo } = useTaskDeletion()
const { displayDay } = useTaskCarryOver(() => props.task)

const columnLabel = computed(() => getStatusLabel(props.task.status))
</script>
