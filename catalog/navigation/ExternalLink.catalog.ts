import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/ExternalLink.vue` (the manifest). */
export default {
  component: 'ExternalLink',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'default', props: { href: 'https://example.org/' }, slot: { $t: 'common.close' } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { href: 'https://example.org/' }, slot: { $t: 'common.close' } },
    { id: 'long-text', state: 'long-text', props: { href: 'https://example.org/' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
