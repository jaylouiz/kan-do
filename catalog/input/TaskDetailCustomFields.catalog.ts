import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailCustomFields.vue` (the manifest). */
export default {
  component: 'TaskDetailCustomFields',
  source: 'app',
  alternatives: ['TaskPropertyRow'],
  sampleNote:
    'its rows are built from a task\'s custom values and each source\'s field types; task-detail.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
