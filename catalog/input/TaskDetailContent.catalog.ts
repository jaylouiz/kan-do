import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskDetailContent.vue` (the manifest). */
export default {
  component: 'TaskDetailContent',
  source: 'app',
  alternatives: ['TaskForm', 'TaskPropertyRow'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'open', label: 'first Offen task of the demo board', fixture: 'firstOpenTask', props: { isPreview: true } }],
  states: [],
} satisfies CatalogEntry
