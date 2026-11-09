import type { CatalogEntry } from '../types'

/**
 * Nuxt UI radio group (reka-ui RadioGroup underneath): the one radio implementation for labelled options. Pictures as
 * options are SwatchRadioGroup; the onboarding cards keep reka-ui's RadioGroup directly (LocalSetupFlow).
 */
export default {
  component: 'URadioGroup',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'A group of exclusive options with labels and descriptions, as a list, a card or a table, vertical or horizontal.',
  usage: 'Two to five exclusive, labelled options that are all worth seeing at once: `color="neutral"`, the `list` variant. Give the group a `legend` or `aria-label`.',
  avoid: 'Not for options that are pictures (SwatchRadioGroup), not for a long list (USelect, USelectMenu) and not for independent yes/no choices (UCheckbox, USwitch).',
  alternatives: ['SwatchRadioGroup', 'USelect', 'UCheckbox'],
  theme: 'radio-group',
  matrix: {
    axes: ['variant', 'orientation'],
    props: {
      color: 'neutral',
      modelValue: 'a',
      items: [
        { label: { $t: 'topic.hue.red' }, value: 'a' },
        { label: { $t: 'topic.hue.green' }, value: 'b' },
      ],
    },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true, color: 'neutral', modelValue: 'a', items: [{ label: { $t: 'topic.hue.red' }, value: 'a' }, { label: { $t: 'topic.hue.green' }, value: 'b' }] } },
    { id: 'long-text', state: 'long-text', label: 'long German label', props: { color: 'neutral', modelValue: 'a', items: [{ label: { $t: 'board.dropToComplete' }, value: 'a' }, { label: { $t: 'topic.hue.green' }, value: 'b' }] } },
  ],
} satisfies CatalogEntry
