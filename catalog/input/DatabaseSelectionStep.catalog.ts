import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/DatabaseSelectionStep.vue` (the manifest). */
export default {
  component: 'DatabaseSelectionStep',
  source: 'app',
  alternatives: ['USelect'],
  sampleNote:
    'a wizard step that loads the user\'s Notion databases; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
