import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/SwatchRadioGroup.vue` (the manifest). */

/** The option content (the colour dot, the glyph) is a slot the samples cannot fill, so the swatches show the ring and the cell only. */
export default {
  component: 'SwatchRadioGroup',
  source: 'app',
  alternatives: ['URadioGroup', 'ChoiceChip'],
  variants: [
    { id: 'swatch', props: { variant: 'swatch', label: { $t: 'topic.editor.color' }, modelValue: 'red', options: [{ key: null, label: { $t: 'topic.editor.colorNone' } }, { key: 'red', label: { $t: 'topic.hue.red' } }, { key: 'green', label: { $t: 'topic.hue.green' } }, { key: 'blue', label: { $t: 'topic.hue.blue' } }] } },
    { id: 'glyph', props: { variant: 'glyph', columns: 4, label: { $t: 'topic.editor.symbol' }, modelValue: 'red', options: [{ key: null, label: { $t: 'topic.editor.colorNone' } }, { key: 'red', label: { $t: 'topic.hue.red' } }, { key: 'green', label: { $t: 'topic.hue.green' } }, { key: 'blue', label: { $t: 'topic.hue.blue' } }] } },
  ],
  states: [
    { id: 'selected', state: 'selected', label: 'none selected (first is the Tab stop)', props: { variant: 'swatch', label: { $t: 'topic.editor.color' }, modelValue: null, options: [{ key: null, label: { $t: 'topic.editor.colorNone' } }, { key: 'red', label: { $t: 'topic.hue.red' } }, { key: 'green', label: { $t: 'topic.hue.green' } }, { key: 'blue', label: { $t: 'topic.hue.blue' } }] } },
    { id: 'focus', state: 'focus', props: { variant: 'swatch', label: { $t: 'topic.editor.color' }, modelValue: 'red', options: [{ key: null, label: { $t: 'topic.editor.colorNone' } }, { key: 'red', label: { $t: 'topic.hue.red' } }, { key: 'green', label: { $t: 'topic.hue.green' } }, { key: 'blue', label: { $t: 'topic.hue.blue' } }] } },
  ],
} satisfies CatalogEntry
