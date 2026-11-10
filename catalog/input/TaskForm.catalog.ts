import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskForm.vue` (the manifest). */
export default {
  component: 'TaskForm',
  source: 'app',
  alternatives: ['TaskDetailContent', 'TaskPropertyRow'],
  sampleNote:
    'the add form: it needs the add-sheet composables, the sources and the stores; task-form-structure.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
