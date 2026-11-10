import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/PriorityMappingStep.vue` (the manifest). */
export default {
  component: 'PriorityMappingStep',
  source: 'app',
  alternatives: ['USelectMenu'],
  sampleNote:
    'a wizard step fed by the controller\'s priority options; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
