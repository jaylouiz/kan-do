import type { CatalogEntry } from '../types'

/**
 * Nuxt UI field wrapper: label, hint, help and error around one control. The theme sets the one error colour
 * (`error-700`, AA on the page ground); call sites only place it (`:ui` for `root` and an `sr-only` label).
 */
export default {
  component: 'UFormField',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'input',
  description: 'The one field wrapper: a label, an optional description and hint, help text below the control and an error that replaces it.',
  usage: 'Around every labelled control (UInput, USelect, UTextarea, UCheckbox, USwitch): `label` names it, `help` explains it, `error` shows the failure below the control at one placement (the control gets `color="error"` and `highlight`). A visually hidden label is `:ui="{ label: \'sr-only\' }"`, never a missing one.',
  avoid: 'Not around a control that has no label of its own (a title field in a card keeps its own error line), not around a button and not as a layout grid: spacing between fields belongs to the parent.',
  alternatives: ['UInput', 'USelect', 'TaskPropertyRow'],
  theme: 'form-field',
  matrix: {
    axes: ['size'],
    props: { label: { $t: 'task.field.notes' }, help: { $t: 'task.form.durationHint' } },
  },
  states: [
    { id: 'error', state: 'error', props: { label: { $t: 'task.field.title' }, error: { $t: 'task.form.titleRequired' } } },
    { id: 'required', state: 'focus', label: 'required with help', props: { label: { $t: 'task.field.title' }, required: true, help: { $t: 'task.form.durationHint' } } },
    { id: 'long-text', state: 'long-text', label: 'long German help', props: { label: { $t: 'task.field.notes' }, help: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
