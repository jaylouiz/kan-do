import type { CatalogEntry } from '../types'

/** Nuxt UI switch; the app theme draws the off state with a visible border and thumb (#683). */
export default {
  component: 'USwitch',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'An on/off switch with an optional label and description; the app theme gives the off state a border and a muted thumb so it reads as off.',
  usage: 'A setting that takes effect at once (stack cards, a recap preference). `color="neutral"`, the default size; label it with `label` or `aria-label`.',
  avoid: 'Not for a choice confirmed by a save button (UCheckbox) and not for exclusive options (URadioGroup).',
  alternatives: ['UCheckbox', 'URadioGroup'],
  theme: 'switch',
  matrix: {
    axes: ['color', 'size'],
    props: { label: { $t: 'board.sync.stackCards' } },
  },
  states: [
    { id: 'selected', state: 'selected', props: { modelValue: true, label: { $t: 'board.sync.stackCards' } } },
    { id: 'disabled', state: 'disabled', props: { disabled: true, label: { $t: 'board.sync.stackCards' } } },
    { id: 'loading', state: 'loading', props: { loading: true, label: { $t: 'board.sync.stackCards' } } },
    { id: 'focus', state: 'focus', props: { label: { $t: 'board.sync.stackCards' } } },
    { id: 'long-text', state: 'long-text', label: 'long German label', props: { label: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
