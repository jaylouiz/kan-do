import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskPriorityBadge',
  source: 'app',
  alternatives: ['UBadge'],
  variants: [
    { id: 'p1-sm', label: 'priority 1, sm', props: { priority: 1, size: 'sm' } },
    { id: 'p1-md', label: 'priority 1, md', props: { priority: 1, size: 'md' } },
    { id: 'p2-sm', label: 'priority 2, sm', props: { priority: 2, size: 'sm' } },
    { id: 'p2-md', label: 'priority 2, md', props: { priority: 2, size: 'md' } },
    { id: 'p3-sm', label: 'priority 3, sm', props: { priority: 3, size: 'sm' } },
    { id: 'p3-md', label: 'priority 3, md', props: { priority: 3, size: 'md' } },
    { id: 'size-xs', props: { priority: 1, size: 'xs' } },
    { id: 'size-lg', props: { priority: 1, size: 'lg' } },
    { id: 'size-xl', props: { priority: 1, size: 'xl' } },
  ],
  states: [],
} satisfies CatalogEntry
