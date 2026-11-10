import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'MorePanel',
  source: 'app',
  alternatives: ['AppNav', 'SettingsSubpageLink'],
  host: 'board',
  screen: '/tasks',
  variants: [{ id: 'panel', label: 'the more panel on a board' }],
  states: [],
} satisfies CatalogEntry
