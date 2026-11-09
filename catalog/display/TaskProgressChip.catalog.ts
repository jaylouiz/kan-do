import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskProgressChip',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'boxed', props: { taskId: 'cat-1', timeBoxSeconds: 3600, timeSpentSeconds: 1500, isNow: false } },
    { id: 'now', props: { taskId: 'cat-1', timeBoxSeconds: 3600, timeSpentSeconds: 1500, isNow: true } },
  ],
  states: [
    { id: 'error', state: 'error', label: 'over the timebox', props: { taskId: 'cat-1', timeBoxSeconds: 3600, timeSpentSeconds: 4500, isNow: false } },
  ],
} satisfies CatalogEntry
