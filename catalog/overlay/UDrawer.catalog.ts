import type { CatalogEntry } from '../types'

/** Nuxt UI UDrawer; its entry carries the text (a library component has no doc block). */
export default {
  component: 'UDrawer',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'overlay',
  description: 'A panel that slides up from the bottom edge (a bottom sheet) on a phone.',
  usage: 'Only through ResponsiveOverlay (below 768 px its bottom sheet); TopicEditorHost uses it on a phone and is an inline panel from 768 px. The theme sets scrim and z-index.',
  avoid: 'Not a desktop dialog (UModal) and not a persistent side panel.',
  alternatives: ['ResponsiveOverlay', 'UModal', 'USlideover'],
  theme: 'drawer',
  // Opened, an overlay covers the page, so the sample is the closed trigger (a button); the open look is the app blocks' and the fingerprint specs' (overlay-scrim, overlay-elevation, modal-style).
  variants: [
    { id: 'trigger', label: 'trigger (closed)', props: { title: { $t: 'common.settings' } }, slot: { $t: 'common.settings' }, trigger: true },
  ],
  states: [],
} satisfies CatalogEntry
