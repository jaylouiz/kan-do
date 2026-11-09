import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/mapping/PropertyMapper.vue` (the manifest). */
export default {
  component: 'PropertyMapper',
  source: 'app',
  alternatives: ['USelect', 'UFormField'],
  sampleNote:
    'it maps the properties of a real Notion database (a store-fed list of fields); notion-setup-stepper.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
