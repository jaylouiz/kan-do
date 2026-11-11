import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/setup/LocalSetupFlow.vue` (the manifest). Its two choice cards are ChoiceCards with a `value` inside reka-ui's RadioGroup. */
export default {
  component: 'LocalSetupFlow',
  source: 'app',
  alternatives: ['ChoiceCard', 'URadioGroup'],
  host: 'board',
  screen: '/welcome',
  variants: [{ id: 'flow', label: 'choose how to start' }],
  states: [],
} satisfies CatalogEntry
