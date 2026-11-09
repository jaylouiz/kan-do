import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailNotes.vue` (the manifest). */
export default {
  component: 'TaskDetailNotes',
  source: 'app',
  alternatives: ['UTextarea', 'InlineEditable'],
  sampleNote:
    'it edits the notes of the open task through the sheet\'s composables; task-detail.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
