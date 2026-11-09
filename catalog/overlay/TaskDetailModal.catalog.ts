import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDetailModal',
  source: 'app',
  alternatives: ['TaskSheet', 'UModal'],
  sampleNote: 'is an overlay: opened, it covers the page it is shown in, so it has no inline sample. It opens from its trigger in the app; it needs a task from the store.',
  states: [],
} satisfies CatalogEntry
