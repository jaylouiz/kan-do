import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailContent.vue` (the manifest). */
export default {
  component: 'TaskDetailContent',
  source: 'app',
  alternatives: ['TaskForm', 'TaskPropertyRow'],
  sampleNote:
    'the task sheet\'s body: it edits the open task through useTaskDetail and the stores; task-detail.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
