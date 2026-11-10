import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskCarryOverTriage.vue` (the manifest). Its three buttons are the `UButton` ghost neutral `sm` of the UButton entry. */
export default {
  component: 'TaskCarryOverTriage',
  source: 'app',
  alternatives: ['UButton'],
  host: 'board',
  screen: '/tasks',
  variants: [
    { id: 'nudge', label: 'the card carried over longest', fixture: 'carriedOverTask' },
    { id: 'compact', label: 'compact, inside a closing-step row', fixture: 'carriedOverTask', props: { compact: true } },
  ],
  states: [],
} satisfies CatalogEntry
