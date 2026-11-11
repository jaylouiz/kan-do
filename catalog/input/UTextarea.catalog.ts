import type { CatalogEntry } from '../types'

/** Nuxt UI textarea: the notes of the task sheet, the add form and the feedback dialog. */
export default {
  component: 'UTextarea',
  source: 'nuxt-ui',
  kind: 'primitive',
  category: 'input',
  description: 'The multi-line text field: the same variants, colours and sizes as UInput, with an optional auto-resize.',
  usage: 'Several lines of free text: notes, feedback. Inside a UFormField when it has a label; `rows` sets the start height, `autoresize` grows it. Set no size: the theme field size applies.',
  avoid: 'Not for a single line (UInput) and not for read-or-edit in place (InlineEditable with `multiline`).',
  alternatives: ['UInput', 'InlineEditable'],
  theme: 'textarea',
  matrix: {
    axes: ['size'],
    props: { rows: 2, placeholder: { $t: 'task.form.notesPlaceholder' } },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true, rows: 2, placeholder: { $t: 'task.form.notesPlaceholder' } } },
    { id: 'error', state: 'error', props: { color: 'error', highlight: true, rows: 2, placeholder: { $t: 'task.form.notesPlaceholder' } } },
    { id: 'focus', state: 'focus', props: { rows: 2, placeholder: { $t: 'task.form.notesPlaceholder' } } },
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { rows: 2, modelValue: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
