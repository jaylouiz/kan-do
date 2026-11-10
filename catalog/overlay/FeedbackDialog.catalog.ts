import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'FeedbackDialog',
  source: 'app',
  alternatives: ['UModal'],
  screen: '/tasks',
  sampleNote: 'is an overlay: opened, it covers the page it is shown in, so it has no inline sample. It opens from its trigger in the app (command palette); its steps need the feedback composable and a screenshot.',
  states: [],
} satisfies CatalogEntry
