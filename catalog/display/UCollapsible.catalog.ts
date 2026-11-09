import type { CatalogEntry } from '../types'

export default {
  component: 'UCollapsible',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'display',
  description: 'A trigger that shows or hides a block of content with a height animation.',
  usage: 'A secondary detail the user opens on purpose (the task sheet metadata). The default slot is the trigger, `content` the revealed part.',
  avoid: 'Not a tab set (UTabs) and not a modal; a disclosure tile with its own heading structure is StatsTile.',
  alternatives: ['StatsTile', 'TaskDetailMetadata'],
  theme: 'collapsible',
  variants: [
    { id: 'closed', props: {  }, slot: { $t: 'common.save' } },
  ],
  states: [
    { id: 'open', state: 'open', props: {  }, slot: { $t: 'common.save' }, open: true },
  ],
} satisfies CatalogEntry
