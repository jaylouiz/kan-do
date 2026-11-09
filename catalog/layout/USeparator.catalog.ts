import type { CatalogEntry } from '../types'

export default {
  component: 'USeparator',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'layout',
  description: 'A hairline between groups of content, horizontal or vertical, solid, dashed or dotted, optionally with a label or icon in the middle. The app sets no variant: the default `neutral` solid line.',
  usage: 'Between the groups of a popover or menu panel (the app bar\'s MorePanel), with a `my-1` margin from the call site. Place it with a class; do not restyle its colour.',
  avoid: 'Not a section heading (SectionHeader) and not a card edge: grouped content on a page is spaced, not ruled; do not stack one under every row of a list (ListRow carries its own hairline).',
  alternatives: ['SectionHeader'],
  theme: 'separator',
  matrix: { axes: ['color', 'size', 'type'], props: { class: 'w-24' } },
  variants: [
    { id: 'label', label: 'with a label', props: { label: { $t: 'nav.settings' }, class: 'w-48' } },
  ],
  states: [],
} satisfies CatalogEntry
