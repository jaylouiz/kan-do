import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/notion/setup/wizard/steps/TokenStep.vue` (the manifest). */
export default {
  component: 'TokenStep',
  source: 'app',
  alternatives: ['UInput', 'UFormField'],
  screen: '/settings/notion',
  variants: [
    { id: 'empty', props: { modelValue: '' } },
    { id: 'broken', label: 'connection broken: info banner', props: { modelValue: '', infoMessage: 'Die Verbindung zu Notion ist abgelaufen. Gib dein Token neu ein.' } },
  ],
  states: [],
} satisfies CatalogEntry
