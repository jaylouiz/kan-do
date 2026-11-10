import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsVerdict',
  source: 'app',
  alternatives: ['StatsTile'],
  screen: '/statistics',
  variants: [{ id: 'demo', label: 'verdict of the demo board', fixture: 'statsReview' }],
  states: [{ id: 'empty', state: 'empty', label: 'no completed task yet', fixture: 'statsReviewEmpty' }],
} satisfies CatalogEntry
