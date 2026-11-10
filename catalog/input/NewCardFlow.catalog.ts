import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/NewCardFlow.vue` (the manifest). */
export default {
  component: 'NewCardFlow',
  source: 'app',
  alternatives: ['ChoiceChip', 'TaskDraftCard'],
  screen: '/tasks',
  sampleNote:
    'a block over the board: it needs the board and tasks stores, the sources and the card it replaces; new-card-flow.spec.ts exercises it (its answers are ChoiceChip `pill`).',
  states: [],
} satisfies CatalogEntry
