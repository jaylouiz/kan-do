import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/ChoiceChip.vue` (the manifest). */

export default {
  component: 'ChoiceChip',
  source: 'app',
  alternatives: ['ChoiceCard', 'UButton', 'TaskPropertySelect', 'PropertyValueTrigger', 'SwatchRadioGroup'],
  variants: [
    { id: 'chip', slot: { $t: 'topic.hue.red' } },
    { id: 'field', label: 'as field (Mehr)', props: { field: true }, slot: { $t: 'board.quickAdd.more' } },
    { id: 'square', label: 'icon only', props: { square: true, 'aria-label': { $t: 'board.quickAdd.allOptions' } }, slot: '···' },
  ],
  states: [
    { id: 'selected', state: 'selected', label: 'picked', props: { picked: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'current', state: 'selected', label: 'current value (ring)', props: { current: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'disabled', state: 'disabled', props: { disabled: true }, slot: { $t: 'topic.hue.green' } },
    { id: 'focus', state: 'focus', slot: { $t: 'topic.hue.red' } },
    { id: 'icon-only', state: 'icon-only', props: { square: true, 'aria-label': { $t: 'board.quickAdd.allOptions' } }, slot: '···' },
    { id: 'long-text', state: 'long-text', label: 'long German text', slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
