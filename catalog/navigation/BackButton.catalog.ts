import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/BackButton.vue` (the manifest). */

export default {
  component: 'BackButton',
  source: 'app',
  alternatives: ['UButton', 'ListRow'],
  variants: [
    { id: 'step', label: 'a step inside a flow (emits click)', props: { label: { $t: 'onboarding.flow.backToChoice' } } },
    { id: 'route', label: 'a deeper route (a link to its parent)', props: { label: { $t: 'common.backToSettings' }, to: '/settings' } },
  ],
  states: [
    { id: 'focus', state: 'focus', props: { label: { $t: 'onboarding.flow.backToChoice' } } },
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { label: { $t: 'board.dropToComplete' } } },
  ],
} satisfies CatalogEntry
