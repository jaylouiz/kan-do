import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'FeedbackImage',
  source: 'app',
  alternatives: [],
  screen: '/tasks',
  variants: [{ id: 'marked', label: 'screenshot with a rectangle and a redaction', fixture: 'feedbackBitmap', props: { label: 'Screenshot' } }],
  states: [],
} satisfies CatalogEntry
