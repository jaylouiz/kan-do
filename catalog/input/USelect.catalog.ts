import type { CatalogEntry } from '../types'

/**
 * Nuxt UI native-style select. The Notion mapping steps always use `size="lg"` (the form-row height); the theme keeps
 * its own height next to the buttons (DESIGN.md "Buttons" note).
 */
export default {
  component: 'USelect',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'A native-style select: pick one value from a short fixed list, shown as a field with a caret.',
  usage: 'A short, fixed list without search where a field reads better than a menu: the Notion mapping steps (always `size="lg"` inside a UFormField). Set `items` as `{ label, value }`, a `placeholder` and `aria-label` when it has no UFormField label.',
  avoid: 'Not for a list that needs search or free values (USelectMenu), not for a property value in the task sheet (TaskPropertySelect) and not for two or three options that fit as a radio group (URadioGroup).',
  alternatives: ['USelectMenu', 'TaskPropertySelect', 'URadioGroup'],
  theme: 'select',
  matrix: {
    axes: ['size'],
    props: {
      placeholder: { $t: 'task.form.choose' },
      items: [
        { label: { $t: 'topic.hue.red' }, value: 'red' },
        { label: { $t: 'topic.hue.green' }, value: 'green' },
      ],
    },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true, size: 'lg', placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'loading', state: 'loading', props: { loading: true, size: 'lg', placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'error', state: 'error', props: { color: 'error', highlight: true, size: 'lg', placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'focus', state: 'focus', props: { size: 'lg', placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { size: 'lg', modelValue: 'long', items: [{ label: { $t: 'board.dropToComplete' }, value: 'long' }] } },
  ],
} satisfies CatalogEntry
