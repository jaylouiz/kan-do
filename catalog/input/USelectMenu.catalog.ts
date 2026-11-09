import type { CatalogEntry } from '../types'

/** Nuxt UI searchable select menu; the app adds the `property` variant (a text trigger for the task sheet's property rows). */
export default {
  component: 'USelectMenu',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'input',
  description: 'A select with a popover list, search and optional multiple values; the app theme adds the `property` variant, a plain-text trigger with a dotted rule on hover.',
  usage: 'A value from a list that needs search or free entry: the Notion priority mapping, and (as the `property` variant, wrapped by TaskPropertySelect) the property rows of the task sheet. Never set the `property` look through `:ui`.',
  avoid: 'Not for a short fixed list without search (USelect) and not for choosing one of two or three (URadioGroup); in the task sheet use TaskPropertySelect, not a bare USelectMenu.',
  alternatives: ['USelect', 'TaskPropertySelect', 'TopicPropertyPicker'],
  theme: 'select-menu',
  matrix: {
    axes: ['variant', 'size'],
    props: {
      placeholder: { $t: 'task.form.choose' },
      items: [
        { label: { $t: 'topic.hue.red' }, value: 'red' },
        { label: { $t: 'topic.hue.green' }, value: 'green' },
      ],
    },
  },
  states: [
    { id: 'disabled', state: 'disabled', props: { disabled: true, placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'loading', state: 'loading', props: { loading: true, placeholder: { $t: 'task.form.choose' }, items: [] } },
    { id: 'focus', state: 'focus', props: { placeholder: { $t: 'task.form.choose' }, items: [] } },
  ],
} satisfies CatalogEntry
