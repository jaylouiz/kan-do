import type { CatalogEntry } from '../types'

/** Nuxt UI UTooltip; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UTooltip',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'overlay',
  description: 'A one-line label that appears on hover or focus of its trigger.',
  usage: 'Names an icon-only control or adds a shortcut hint (kbds); the trigger keeps its own aria-label.',
  avoid: 'Not for information the user needs to proceed (put it on the page), not on touch-only controls and not for long text.',
  alternatives: ['UPopover'],
  theme: 'tooltip',
  variants: [
    { id: 'text', label: 'with text', props: { text: { $t: 'common.close' } }, slot: { $t: 'common.save' }, trigger: true },
    { id: 'kbds', label: 'with shortcut', props: { text: { $t: 'common.close' }, kbds: ['esc'] }, slot: { $t: 'common.save' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
