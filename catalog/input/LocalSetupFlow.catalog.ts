import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/setup/LocalSetupFlow.vue` (the manifest). */
export default {
  component: 'LocalSetupFlow',
  source: 'app',
  alternatives: ['URadioGroup'],
  sampleNote:
    'the onboarding page\'s flow: it creates the board through the stores; its two choice cards use reka-ui\'s RadioGroup directly (see URadioGroup); smoke.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
