import type { CatalogEntry } from '../types'

/** Nuxt UI UModal; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UModal',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'overlay',
  description: 'A centred dialog on a scrim: a title, a body, a footer with the actions, closed with Esc, the scrim or the close button.',
  usage: 'A confirmation or a short form on desktop. Declare the width through MODAL_WIDTH (sm confirmations, md forms, lg wide content) in the :ui prop; the footer is right-aligned by the theme. A dialog that must be a drawer on a phone is ResponsiveOverlay.',
  avoid: 'Not for a hint on hover (UTooltip), a small menu next to a control (UPopover) or an inline notice (UAlert); no ad-hoc max-width classes and no identity classes in :ui (they belong in the theme).',
  alternatives: ['ResponsiveOverlay', 'UDrawer', 'USlideover'],
  theme: 'modal',
  // Opened, an overlay covers the page, so the sample is the closed trigger (a button); the open look is the app blocks' and the fingerprint specs' (overlay-scrim, overlay-elevation, modal-style).
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: { title: { $t: 'common.close' } }, slot: { $t: 'common.save' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
