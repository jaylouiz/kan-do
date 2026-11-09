import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskCarryOverDots.vue` (the manifest). */
export default {
  component: 'TaskCarryOverDots',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'day-2', props: { day: 2 } },
    { id: 'day-4', props: { day: 4 } },
    { id: 'decorative', props: { day: 3, decorative: true } },
  ],
  states: [
    { id: 'over-cap', state: 'long-text', label: 'past the dot cap', props: { day: 12 } },
  ],
} satisfies CatalogEntry
