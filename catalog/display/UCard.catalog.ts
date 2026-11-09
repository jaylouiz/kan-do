import type { CatalogEntry } from '../types'

export default {
  component: 'UCard',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'display',
  description: 'A surface with optional header, body and footer; the app adds the `task` variant (the board card: elevated ground, tight padding).',
  usage: 'Only `variant="task"` for the board card (TaskCard). Grouped surfaces other than the board card use the plain hairline layout of the page, not a card.',
  avoid: 'Not a list row (ListRow) and not a modal surface (UModal); do not nest cards.',
  alternatives: ['TaskCard', 'ListRow'],
  theme: 'card',
  matrix: { axes: ['variant'], slot: { $t: 'board.dropToComplete' } },
  states: [],
} satisfies CatalogEntry
