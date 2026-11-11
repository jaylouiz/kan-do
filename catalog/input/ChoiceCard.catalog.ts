import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/ChoiceCard.vue` (the manifest). */

export default {
  component: 'ChoiceCard',
  source: 'app',
  alternatives: ['ChoiceChip', 'URadioGroup', 'ListRow'],
  variants: [
    { id: 'go-on', label: 'answer that opens something (arrow)', props: { icon: 'i-ph-desktop' }, slot: { $t: 'onboarding.page.nowhere' } },
  ],
  states: [
    { id: 'disabled', state: 'disabled', props: { icon: 'i-ph-desktop', disabled: true }, slot: { $t: 'onboarding.page.nowhere' } },
    { id: 'focus', state: 'focus', props: { icon: 'i-ph-desktop' }, slot: { $t: 'onboarding.page.nowhere' } },
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { icon: 'i-ph-desktop' }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
