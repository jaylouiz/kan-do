import type { CatalogEntry } from '../types'

/** Nuxt UI searchable select menu; the app themes `soft` (muted fill and chevron, the select of the task sheet's property rows, #114) and adds `property` (the plain text trigger of a footer line). */
export default {
  component: 'USelectMenu',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'input',
  description: 'A select with a popover list, search and optional multiple values; the app theme restyles `soft` (muted fill, chevron, the 36 px field height: the select of the task sheet) and adds `property`, a plain-text trigger with a dotted rule on hover.',
  usage: 'A value from a list that needs search or free entry: the Notion priority mapping, and (as the `soft` variant, wrapped by TaskPropertySelect) the property rows of the task sheet. Never set the `soft` or `property` look through `:ui`.',
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
