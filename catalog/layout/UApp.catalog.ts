import type { CatalogEntry } from '../types'

export default {
  component: 'UApp',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'layout',
  description: 'The Nuxt UI provider every overlay, toast and tooltip needs: it hosts their portals and the global locale and tooltip settings. It has no look of its own.',
  usage: 'Once, around the whole app (`app.vue`). Toasts, tooltips and overlays render only while a UApp is mounted above them.',
  avoid: 'Never nested and never a layout container: it renders no layout, so use PageHeader and the page layout for structure.',
  alternatives: ['PageHeader'],
  sampleNote: 'is a provider without a look: it renders its slot unchanged and hosts the toast and overlay portals; `/ui` itself runs inside the app\'s one UApp.',
  states: [],
} satisfies CatalogEntry
