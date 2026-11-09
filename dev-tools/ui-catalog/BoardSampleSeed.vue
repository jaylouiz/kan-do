<!--
@component UiCatalogBoardSeed
@description Seeds the throwaway Pinia of a `/ui` board sample with the demo board (#77); a child of UiCatalogBoardHost so every store it touches resolves to the sample's Pinia.
@usage Only inside UiCatalogBoardHost
@responsibility
- Fill the tasks store (tasks, carried-over counters) and the topic styles from `buildDemoBoard()`, the content of `?seed=demo`
- Render its slot, handing it `tasksFor(kind)`: the tasks of one demo column as the store holds them, so a `tasks` prop and the store agree on every id
-->
<template>
  <slot :tasks-for="tasksFor" />
</template>

<script setup lang="ts">
import { buildDemoBoard } from '~/lib/demo-board'
import { useTasksStore } from '~/store/tasks'
import { useTopicStylesStore } from '~/store/topicStyles'
import type { Task } from '~/types/task'
import type { CatalogDemoTasks } from '~/catalog/types'

defineOptions({ name: 'UiCatalogBoardSeed' })

const demo = buildDemoBoard()
const tasks = useTasksStore()
tasks.setTasks(demo.tasks)
tasks.setCarryOver(demo.carryOverByTaskId)
const topicStyles = useTopicStylesStore()
for (const [name, style] of Object.entries(demo.topicStyles)) topicStyles.setStyle(name, style)

/** The tasks of one demo column (Erledigt: today's completions, like the board). */
function tasksFor(kind: CatalogDemoTasks): Task[] {
  if (kind === 'open') return tasks.tasksOpen
  if (kind === 'progress') return tasks.tasksProgress
  if (kind === 'waiting') return tasks.tasksWaiting
  if (kind === 'done') return tasks.tasksDoneToday
  return []
}
</script>
