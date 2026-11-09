import type { CatalogEntry } from '../types'

/** Nuxt UI checkbox: neutral for settings, primary only where a check confirms a mapping. */
export default {
  component: 'UCheckbox',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'A checkbox with an optional label and description, in the semantic colours, with a list and a card variant.',
  usage: 'An independent yes/no among several, or a consent: `color="neutral"` in settings and dialogs. Always give it a `label` (or an `aria-label`).',
  avoid: 'Not for a setting that applies at once (USwitch), not for one of several exclusive options (URadioGroup) and not for a toggle button (UButton with `aria-pressed`).',
  alternatives: ['USwitch', 'URadioGroup'],
  theme: 'checkbox',
  matrix: {
    axes: ['color', 'size'],
    props: { label: { $t: 'board.sync.stackCards' } },
  },
  states: [
    { id: 'selected', state: 'selected', props: { modelValue: true, label: { $t: 'board.sync.stackCards' } } },
    { id: 'disabled', state: 'disabled', props: { disabled: true, label: { $t: 'board.sync.stackCards' } } },
    { id: 'focus', state: 'focus', props: { label: { $t: 'board.sync.stackCards' } } },
    { id: 'long-text', state: 'long-text', label: 'long German label', props: { label: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
