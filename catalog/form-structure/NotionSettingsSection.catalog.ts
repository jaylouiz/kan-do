import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/NotionSettingsSection.vue` (the manifest). */
export default {
  component: 'NotionSettingsSection',
  source: 'app',
  alternatives: ['PropertyMapper'],
  sampleNote:
    'it reads the connected Notion source and its mapping from stores; sources-settings.spec.ts exercises it.',
  states: [],
} satisfies CatalogEntry
