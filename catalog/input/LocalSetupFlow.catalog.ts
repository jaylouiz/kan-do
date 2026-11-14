import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/setup/LocalSetupFlow.vue` (the manifest). */
export default {
  component: 'LocalSetupFlow',
  source: 'app',
  alternatives: ['ChoiceCard', 'URadioGroup'],
  host: 'board',
  screen: '/welcome',
  variants: [{ id: 'flow', label: 'source checklist' }],
  states: [],
} satisfies CatalogEntry
