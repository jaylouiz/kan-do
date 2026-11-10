import type { CatalogEntry } from '../types'

/** Nuxt UI keyboard key (#73): the shortcut hints of the command palette and the more panel. */
export default {
  component: 'UKbd',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'navigation',
  description: 'A keycap for a keyboard shortcut: `value` names a key (`meta`, `enter`, `arrowup`) and renders its symbol; outline, solid and subtle variants in three sizes.',
  usage: 'Shortcut hints beside a command (`kbds` of the command palette, the more panel), the default variant and size. `value` takes the key name so the platform symbol follows (⌘ on macOS, Ctrl elsewhere). The hint of an action inside a flow (NewCardFlow) is a plain `kbd` that shows on fine pointers only.',
  avoid: 'Not for a shortcut that has no visible action, not on a phone (there is no keyboard) and not as a button.',
  alternatives: ['CommandPalette', 'UCommandPalette'],
  theme: 'kbd',
  matrix: { axes: ['variant', 'size'], props: { value: 'enter' } },
  states: [
    { id: 'combo', state: 'long-text', props: { value: 'meta' }, slot: 'K' },
  ],
} satisfies CatalogEntry
