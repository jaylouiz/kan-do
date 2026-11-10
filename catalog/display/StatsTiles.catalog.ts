import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTiles',
  source: 'app',
  alternatives: ['StatsTile'],
  screen: '/statistics',
  variants: [{ id: 'demo', label: 'question tiles of the demo board', fixture: 'statsTiles' }],
  states: [],
} satisfies CatalogEntry
