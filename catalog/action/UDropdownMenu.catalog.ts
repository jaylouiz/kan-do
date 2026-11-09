import type { CatalogEntry } from '../types'

/**
 * Nuxt UI dropdown menu (#71). No samples: a sample can only pass a text slot, and the menu anchors to its trigger
 * element, so an open menu has nothing to hang on (an attempt rendered the bare text and no content); The entry says so in `noSamples`. The menus
 * themselves are covered by `sorting.spec.ts` and `task-detail.spec.ts`; the ColumnSortingControl entry shows the
 * trigger of the choice menu.
 */
export default {
  component: 'UDropdownMenu',
  source: 'nuxt-ui',
  kind: 'compound',
  category: 'action',
  description: 'A menu of actions or choices that opens from a button: items with a leading icon, labels, descriptions, checkbox or radio items and groups.',
  usage: 'Several secondary actions behind one trigger. The trigger is a ghost neutral `UButton`, icon-only ones set an aria-label (task sheet "more actions"); a menu that picks one of a few values shows the active one in the trigger (column sort). Action items carry a leading `i-ph-*` icon (a meaning that has an `ICONS` entry takes the glyph from there) and an i18n label; choice items (checkbox, radio) show their check instead of an icon. A destructive item sets `color: \'error\'`. `:ui` only places (width, wrapping), identity lives in the theme.',
  avoid: 'Not for navigation between places (AppNav, tabs), not for right-click or long-press on a card (TaskCardContextMenu) and not for one action (a `UButton`). Not inside a drawer that has no menu primitive (NewCardFlow keeps plain buttons).',
  alternatives: ['UButton', 'TaskCardContextMenu', 'ColumnSortingControl'],
  theme: 'dropdown-menu',
  noSamples:
    'a sample can only pass a text slot and the menu anchors to its trigger element, so a sample renders nothing; the menus are covered by sorting.spec.ts and task-detail.spec.ts and the ColumnSortingControl entry shows the choice menu\'s trigger.',
  states: [],
} satisfies CatalogEntry
