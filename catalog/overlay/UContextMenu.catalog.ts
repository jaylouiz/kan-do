import type { CatalogEntry } from '../types'

/** Nuxt UI UContextMenu; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UContextMenu',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'overlay',
  description: 'A menu of actions that opens at the pointer on right-click or long-press.',
  usage: 'Wrapping a row or card that has quick actions (the task card); items carry icons from lib/icons.ts and a destructive item uses the error colour.',
  avoid: 'Not the only way to reach an action (it is invisible until used: every action also has a visible control) and not a dropdown from a button.',
  alternatives: ['TaskCardContextMenu', 'UPopover'],
  theme: 'context-menu',
  // Opened, an overlay covers the page, so the sample is the closed trigger (a button); the open look is the app blocks' and the fingerprint specs' (overlay-scrim, overlay-elevation, modal-style).
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: {}, slot: { $t: 'common.save' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
