import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/task/TaskCompletionBurst.vue` (the manifest).
 * No samples on purpose: the pieces fly out of a card and the board clips them (`overflow: clip`, board.css); outside a
 * card they would widen the page, and the one-shot animation has no resting look to fingerprint. It is checked on the
 * board (`timebox-progress-chip`, completion effect specs).
 */
export default {
  component: 'TaskCompletionBurst',
  source: 'app',
  alternatives: [],
  screen: '/tasks',
  sampleNote: 'the pieces fly out of a card and the board clips them; the one-shot animation has no resting look to fingerprint',
  states: [],
} satisfies CatalogEntry
