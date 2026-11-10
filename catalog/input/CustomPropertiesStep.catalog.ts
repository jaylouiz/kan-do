import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/CustomPropertiesStep.vue` (the manifest). */
export default {
  component: 'CustomPropertiesStep',
  source: 'app',
  alternatives: ['PropertyMapper'],
  sampleNote:
    'a wizard step fed by the controller\'s database properties; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
