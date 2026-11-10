import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/settings/GithubTokenRow.vue` (the manifest). */
export default {
  component: 'GithubTokenRow',
  source: 'app',
  alternatives: ['UFormField', 'UInput'],
  sampleNote:
    'desktop only: it reads the Keychain-backed token entry; github-settings.spec.ts and desktop-pages-shots.spec.ts exercise it.',
  states: [],
} satisfies CatalogEntry
