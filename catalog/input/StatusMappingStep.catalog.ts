import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/StatusMappingStep.vue` (the manifest). */
export default {
  component: 'StatusMappingStep',
  source: 'app',
  alternatives: ['USelect'],
  sampleNote:
    'a wizard step fed by the controller\'s status options; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
