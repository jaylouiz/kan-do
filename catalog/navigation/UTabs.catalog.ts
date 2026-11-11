import type { CatalogEntry } from '../types'

const items = [
  { label: { $t: 'settings.tabs.board' }, value: 'board' },
  { label: { $t: 'settings.tabs.sources' }, value: 'sources' },
  { label: { $t: 'settings.tabs.manage' }, value: 'manage' },
]

/** Nuxt UI tabs (#73). The one tab implementation; `design-patterns.test.ts` rejects a hand-rolled `role="tab"`. */
export default {
  component: 'UTabs',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'navigation',
  description: 'A row of tabs that switches between views of one place; the active tab is marked by an indicator. In the theme: neutral, pill and link variants, in sm to xl.',
  usage: 'Switching between a few views of the same page (settings groups, the statistics tiles, the phone recap decks), always `:content="false"` with the page rendering the view. `pill` is the white chip on a grey track; a switcher that must reach 44 px at 390 sets `touch-target` through `:ui` (placement only). Keyboard: arrow keys move, Home/End jump.',
  avoid: 'Not for moving between places of the app (AppNav, whose selected rules are DESIGN.md "Components"), not a step indicator (SetupRail), not a page indicator (BoardPageDots) and not a toggle for one setting (USwitch).',
  alternatives: ['AppNav', 'SetupRail', 'BoardPageDots'],
  theme: 'tabs',
  matrix: { axes: ['variant', 'size'], props: { items, content: false, defaultValue: 'board' } },
  states: [
    { id: 'disabled', state: 'disabled', props: { items: [{ label: { $t: 'settings.tabs.board' }, value: 'board' }, { label: { $t: 'settings.tabs.sources' }, value: 'sources', disabled: true }], content: false, defaultValue: 'board', variant: 'pill' } },
    { id: 'long-text', state: 'long-text', props: { items: [{ label: { $t: 'recap.deck.undone' }, value: 'a' }, { label: { $t: 'board.dropToComplete' }, value: 'b' }], content: false, defaultValue: 'a', variant: 'pill', class: 'max-w-72' } },
  ],
} satisfies CatalogEntry
