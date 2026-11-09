import type { CatalogEntry } from '../types'

/**
 * No samples: the calendar draws the current month and highlights today, so its box and styles move with the date and
 * the style fingerprint would drift; DatePickerField (the one place it is used) shows it in its popover.
 */
export default {
  component: 'UCalendar',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'input',
  description: 'A month calendar to pick a date or a range, in the semantic colours and sizes.',
  usage: 'Only inside DatePickerField\'s popover (a single date or a range, `md`). Dates are `@internationalized/date` values, never strings.',
  avoid: 'Not a standalone page element and not for a date typed as text (UInput); a new date field is a DatePickerField.',
  alternatives: ['DatePickerField'],
  theme: 'calendar',
  sampleNote: 'it draws the current month and marks today, so its styles move with the date; DatePickerField shows it in its popover (task-detail.spec.ts exercises it).',
  states: [],
} satisfies CatalogEntry
