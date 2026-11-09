import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/TokenStep.vue` (the manifest). */
export default {
  component: 'TokenStep',
  source: 'app',
  alternatives: ['UInput', 'UFormField'],
  sampleNote:
    'a wizard step that validates the token against the Notion API; notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
