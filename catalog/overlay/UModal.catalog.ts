import type { CatalogEntry } from '../types'

/** Nuxt UI UModal; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UModal',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'overlay',
  description: 'A centred dialog on a scrim: a title, a body, a footer with the actions, closed with Esc, the scrim or the close button.',
  usage: 'The library modal behind AppDialog and ResponsiveOverlay; the footer is right-aligned by the theme. A call site renders AppDialog (which names the width) or, for a dialog that must be a drawer on a phone, ResponsiveOverlay.',
  avoid: 'Never bare in a component or page (AppDialog). Not for a hint on hover (UTooltip), a small menu next to a control (UPopover) or an inline notice (UAlert); no ad-hoc max-width classes and no identity classes in :ui (they belong in the theme).',
  alternatives: ['ResponsiveOverlay', 'UDrawer', 'USlideover'],
  theme: 'modal',
  // Opened, an overlay covers the page, so the sample is the closed trigger (a button); the open look is the app blocks' and the fingerprint specs' (overlay-scrim, overlay-elevation, modal-style).
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: { title: { $t: 'common.settings' } }, slot: { $t: 'common.settings' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
