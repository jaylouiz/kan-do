import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). One size (kd#180): the three levels. */
export default {
  component: 'TaskPriorityBadge',
  source: 'app',
  alternatives: ['UBadge'],
  variants: [
    { id: 'p1', label: 'priority 1', props: { priority: 1 } },
    { id: 'p2', label: 'priority 2', props: { priority: 2 } },
    { id: 'p3', label: 'priority 3 (High, the tinted one)', props: { priority: 3 } },
  ],
  states: [],
} satisfies CatalogEntry
