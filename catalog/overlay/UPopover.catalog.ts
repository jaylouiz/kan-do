import type { CatalogEntry } from '../types'

/** Nuxt UI UPopover; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UPopover',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'overlay',
  description: 'A small floating panel anchored to a trigger, closed by Esc or an outside click.',
  usage: 'Pickers and short forms next to a control (date picker, topic picker, sync status); position with the content prop, size with :ui content. z-index comes from the theme.',
  avoid: 'Not a modal task (UModal), not a hint (UTooltip) and not a menu of commands (UDropdownMenu).',
  alternatives: ['UTooltip', 'UModal'],
  theme: 'popover',
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: {}, slot: { $t: 'common.save' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
