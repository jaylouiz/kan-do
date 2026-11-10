import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/feedback/FeedbackAnnotator.vue` (the manifest). */
export default {
  component: 'FeedbackAnnotator',
  source: 'app',
  alternatives: ['UButton'],
  screen: '/tasks',
  sampleNote:
    'it draws on a captured screenshot the feedback dialog hands it; feedback.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
