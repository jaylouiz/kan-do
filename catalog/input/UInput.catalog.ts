import type { CatalogEntry } from '../types'

/**
 * Nuxt UI text input. The matrix is the merged theme's variant x size; the app uses the theme default `lg` (36 px, the
 * `--field-h` token; kd#178) everywhere and `xl` only for the title fields.
 */
export default {
  component: 'UInput',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'The one single-line text field: outline, soft, subtle, ghost and none variants with leading and trailing slots, a loading state and a highlight for an error.',
  usage: 'Every typed single-line value. A labelled field sits in a UFormField (label, help, error); a field in a row of the task sheet or a card uses the `ghost` variant and its own label. Set no `size`: the theme default (36 px, 44 px on a phone) is the one field height; only a title field sets `xl`. A field that loads also sets `disabled`. An error sets `color="error"` and `highlight` and shows its text through the UFormField `error`.',
  avoid: 'Not for several lines (UTextarea), not for a choice from a list (USelect, USelectMenu) and not for editing a displayed value in place (InlineEditable).',
  alternatives: ['UTextarea', 'USelect', 'InlineEditable', 'UFormField'],
  theme: 'input',
  matrix: {
    axes: ['variant', 'size'],
    props: { placeholder: { $t: 'task.form.titlePlaceholder' } },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true, placeholder: { $t: 'task.form.titlePlaceholder' } } },
    { id: 'loading', state: 'loading', props: { loading: true, placeholder: { $t: 'board.quickAdd.search' } } },
    { id: 'error', state: 'error', props: { color: 'error', highlight: true, modelValue: '' , placeholder: { $t: 'task.form.titlePlaceholder' } } },
    { id: 'focus', state: 'focus', props: { placeholder: { $t: 'task.form.titlePlaceholder' } } },
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { modelValue: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
