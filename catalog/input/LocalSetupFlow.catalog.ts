import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/setup/LocalSetupFlow.vue` (the manifest). Its two choice cards use reka-ui's RadioGroup directly (see URadioGroup). */
export default {
  component: 'LocalSetupFlow',
  source: 'app',
  alternatives: ['URadioGroup'],
  host: 'board',
  screen: '/welcome',
  variants: [{ id: 'flow', label: 'choose how to start' }],
  states: [],
} satisfies CatalogEntry
