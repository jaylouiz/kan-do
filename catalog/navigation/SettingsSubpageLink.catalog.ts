import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/settings/SettingsSubpageLink.vue` (the manifest). */
export default {
  component: 'SettingsSubpageLink',
  source: 'app',
  alternatives: ['ExternalLink', 'ListRow'],
  variants: [
    {
      id: 'default',
      props: { to: '/settings/github', icon: 'i-ph-key', label: { $t: 'settings.subpages.github.label' }, description: { $t: 'settings.subpages.github.description' } },
    },
  ],
  states: [
    {
      id: 'focus',
      state: 'focus',
      props: { to: '/settings/github', icon: 'i-ph-key', label: { $t: 'settings.subpages.github.label' }, description: { $t: 'settings.subpages.github.description' } },
    },
    {
      id: 'long-text',
      state: 'long-text',
      props: { to: '/settings/github', icon: 'i-ph-key', label: { $t: 'settings.subpages.github.label' }, description: { $t: 'settings.tabs.lead.sources' } },
    },
  ],
} satisfies CatalogEntry
