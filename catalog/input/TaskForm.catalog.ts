import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskForm.vue` (the manifest). */
export default {
  component: 'TaskForm',
  source: 'app',
  alternatives: ['TaskDetailContent', 'TaskPropertyRow'],
  host: 'board',
  screen: '/tasks',
  variants: [
    { id: 'add', label: 'add form', props: { isPreview: true, source: 'local' } },
    { id: 'edit', label: 'edit form of a demo task', fixture: 'firstOpenTaskObject', props: { isPreview: true } },
  ],
  states: [],
} satisfies CatalogEntry
