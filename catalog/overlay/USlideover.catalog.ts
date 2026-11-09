import type { CatalogEntry } from '../types'

/** Nuxt UI USlideover; its entry carries the text (a library component has no doc block). */
export default {
  component: 'USlideover',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'overlay',
  description: 'A panel that slides in from the right edge.',
  usage: 'Only inside ResponsiveOverlay (the task sheet on desktop), width SHEET_WIDTH; it has a transparent overlay so the board stays visible.',
  avoid: 'Not a general dialog (UModal) and not used directly in feature code.',
  alternatives: ['ResponsiveOverlay', 'UModal', 'UDrawer'],
  theme: 'slideover',
  // Opened, an overlay covers the page, so the sample is the closed trigger (a button); the open look is the app blocks' and the fingerprint specs' (overlay-scrim, overlay-elevation, modal-style).
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: { title: { $t: 'common.settings' } }, slot: { $t: 'common.settings' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
