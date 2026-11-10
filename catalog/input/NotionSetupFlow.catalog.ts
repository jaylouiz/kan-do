import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/setup/NotionSetupFlow.vue` (the manifest). */
export default {
  component: 'NotionSetupFlow',
  source: 'app',
  alternatives: ['WizardController'],
  screen: '/welcome',
  sampleNote:
    'the onboarding page\'s Notion flow around the setup wizard; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
