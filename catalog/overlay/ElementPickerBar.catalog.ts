import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'ElementPickerBar',
  source: 'app',
  alternatives: ['UTooltip', 'FeedbackDialog'],
  sampleNote: 'is the chrome of the feedback element picker: it follows the pointer over the live page (needs the picker state), so it has no inline sample.',
  states: [],
} satisfies CatalogEntry
