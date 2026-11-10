import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'BoardColumnItem',
  source: 'app',
  alternatives: ['SortableTaskWrapper', 'TaskStack', 'TaskCard'],
  screen: '/tasks',
  sampleNote: 'renders one item of a column list (a card, a collapsed stack, an expanded stack header or a deleted-card gap) and needs the list the column builds around it; each item type is shown by its own component (TaskCard, TaskStack, TaskStackHeader, TaskDeletedGap) and in context by BoardColumn.',
  states: [],
} satisfies CatalogEntry
