import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'PageHeader',
  source: 'app',
  alternatives: ['SectionHeader'],
  variants: [
    { id: 'default', props: { title: { $t: 'settings.data.pageTitle' }, description: { $t: 'settings.data.pageDescription' } } },
    { id: 'title-only', props: { title: { $t: 'settings.updates.pageTitle' } } },
    { id: 'narrow', label: 'narrow (672 px column of /settings/*)', props: { title: { $t: 'settings.data.pageTitle' }, description: { $t: 'settings.data.pageDescription' }, narrow: true } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { title: { $t: 'board.dropToComplete' }, description: { $t: 'settings.updates.pageDescription' }, narrow: true } },
  ],
} satisfies CatalogEntry
