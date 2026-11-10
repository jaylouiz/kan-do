import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'NotionSetupModal',
  source: 'app',
  alternatives: ['UModal'],
  host: 'board',
  launch: 'open',
  screen: '/settings/notion',
  variants: [{ id: 'setup', label: 'first connection (token step)', props: { forceSetup: true } }],
  states: [],
} satisfies CatalogEntry
