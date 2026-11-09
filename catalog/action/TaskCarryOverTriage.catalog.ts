import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/task/TaskCarryOverTriage.vue` (the manifest).
 * No samples: the block renders nothing unless the task of its `taskId` is in the tasks store and carried over several
 * days, and `/ui` has no board state. Its three buttons are the `UButton` ghost neutral `sm` of the UButton entry.
 */
export default {
  component: 'TaskCarryOverTriage',
  source: 'app',
  alternatives: ['UButton'],
  noSamples:
    'it renders nothing unless its task is in the tasks store and carried over several days; /ui has no board state. Its three buttons are the UButton ghost neutral sm of the UButton entry.',
  states: [],
} satisfies CatalogEntry
