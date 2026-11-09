import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'RecapDeck',
  source: 'app',
  alternatives: ['TaskCard'],
  sampleNote: 'deals TaskCard instances with swipe state from the new-day recap; needs the recap composable.',
  states: [],
} satisfies CatalogEntry
