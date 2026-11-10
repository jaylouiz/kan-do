import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/WizardController.vue` (the manifest). */
export default {
  component: 'WizardController',
  source: 'app',
  alternatives: ['MappingStep'],
  screen: '/settings/notion',
  sampleNote:
    'it drives the Notion setup steps against the API client and the settings store; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
