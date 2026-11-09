import type { CatalogEntry } from '../types'

/** Nuxt UI link (a NuxtLink with active and disabled classes). Text and usage live here: a library component has no doc block. */
export default {
  component: 'ULink',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'action',
  description: 'Text link to a page inside the app, with the theme\'s active and disabled looks.',
  usage: 'An in-app link inside a sentence (the feedback dialog\'s "Zugang einrichten"): `to` is a route and the caller adds the underline. Without a `class` it is unstyled apart from the theme\'s active colour.',
  avoid: 'Not for a page outside the app (ExternalLink: it opens the system browser on desktop), not for an action (UButton, `link` variant when it must read as text), not for a settings row (SettingsSubpageLink).',
  alternatives: ['ExternalLink', 'UButton'],
  theme: 'link',
  variants: [
    { id: 'default', props: { to: '/tasks', class: 'underline' }, slot: { $t: 'common.settings' } },
    { id: 'active', props: { to: '/tasks', active: true, class: 'underline' }, slot: { $t: 'common.settings' } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { to: '/tasks', class: 'underline' }, slot: { $t: 'common.settings' } },
    { id: 'disabled', state: 'disabled', props: { to: '/tasks', disabled: true, class: 'underline' }, slot: { $t: 'common.settings' } },
    { id: 'long-text', state: 'long-text', props: { to: '/tasks', class: 'underline' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
