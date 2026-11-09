import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/ChoiceChip.vue` (the manifest). */

export default {
  component: 'ChoiceChip',
  source: 'app',
  alternatives: ['UButton', 'PropertyValueTrigger', 'SwatchRadioGroup'],
  variants: [
    { id: 'pill', props: { shape: 'pill' }, slot: { $t: 'topic.hue.red' } },
    { id: 'pill-field', label: 'pill as field (Mehr)', props: { shape: 'pill', field: true }, slot: { $t: 'board.quickAdd.more' } },
    { id: 'chip', props: { shape: 'chip' }, slot: { $t: 'topic.hue.green' } },
    { id: 'icon', props: { shape: 'icon', 'aria-label': { $t: 'board.quickAdd.allOptions' } }, slot: '···' },
    { id: 'row', props: { shape: 'row' }, slot: { $t: 'topic.hue.blue' } },
    { id: 'row-large', props: { shape: 'row', large: true }, slot: { $t: 'topic.hue.blue' } },
  ],
  states: [
    { id: 'selected', state: 'selected', label: 'picked pill', props: { shape: 'pill', picked: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'current', state: 'selected', label: 'current value (ring)', props: { shape: 'pill', current: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'disabled', state: 'disabled', props: { shape: 'chip', disabled: true }, slot: { $t: 'topic.hue.green' } },
    { id: 'focus', state: 'focus', props: { shape: 'pill' }, slot: { $t: 'topic.hue.red' } },
    { id: 'icon-only', state: 'icon-only', props: { shape: 'icon', 'aria-label': { $t: 'board.quickAdd.allOptions' } }, slot: '···' },
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { shape: 'pill' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
