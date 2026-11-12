import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'PageSheet',
  source: 'app',
  alternatives: ['UCard'],
  variants: [
    { id: 'sheet', label: 'a settings section', props: { tag: 'section' }, slot: { $t: 'settings.data.folderHeading' } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: { tag: 'section' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
