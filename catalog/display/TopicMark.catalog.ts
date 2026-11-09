import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TopicMark',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'symbol', props: { hue: 'green', symbol: 'leaf' } },
    { id: 'hue-only', props: { hue: 'blue', symbol: null } },
  ],
  states: [],
} satisfies CatalogEntry
