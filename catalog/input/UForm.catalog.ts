import type { CatalogEntry } from '../types'

/** No samples: a form element has no chrome of its own; its look is the fields inside it. */
export default {
  component: 'UForm',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'input',
  description: 'A form element that validates its fields (schema or `validate`) and focuses the first error on submit.',
  usage: 'Around a form whose fields validate together (TaskForm). Fields inside are UFormFields with a `name`; submit goes through `@submit`.',
  avoid: 'Not for one control that saves on change (InlineEditable, USwitch) and not as layout: a plain `<form>` is enough when nothing validates.',
  alternatives: ['UFormField'],
  theme: 'form',
  sampleNote: 'a form element has no chrome of its own; its look is the UFormFields inside it (see UFormField) and TaskForm shows it (task-form-structure.spec.ts).',
  states: [],
} satisfies CatalogEntry
