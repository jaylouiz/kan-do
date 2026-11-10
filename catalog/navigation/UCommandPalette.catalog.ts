import type { CatalogEntry } from '../types'

/** Nuxt UI command palette (#73): used once, inside the `CommandPalette` modal. */
export default {
  component: 'UCommandPalette',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'navigation',
  description: 'A searchable list of grouped commands with a search field, keyboard navigation and an empty and a loading state.',
  usage: 'The body of the Cmd/Ctrl+K palette: `groups` of items with an icon, a label and `kbds`, `loading` while the tasks load, an `#empty` slot with EmptyNote, `:back="false"`. `:ui` only places (padding, height).',
  avoid: 'Not for navigation by pointer (AppNav, MorePanel) and not a select (USelectMenu); the palette is desktop and keyboard only.',
  alternatives: ['CommandPalette', 'UKbd'],
  theme: 'command-palette',
  sampleNote:
    'it filters through a fuse index over groups and lives inside the palette modal\'s focus trap; the samples would be inert and unfocusable, so CommandPalette is exercised by command-palette.spec.ts (empty and loading included).',
  states: [],
} satisfies CatalogEntry
