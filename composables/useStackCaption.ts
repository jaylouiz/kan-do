import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * The visual caption of a stack, "<group> · <n> Aufgaben" (#148): what the collapsed stack shows below
 * its cards and what the expanded header row shows. Not the accessible name: screen readers may read
 * the middle dot aloud, so the collapsed stack names itself with `board.stack.label` ("<front title>, <group>, <n> Aufgaben"), which
 * holds the front card's visible title and the caption text (WCAG 2.5.3).
 */
export function useStackCaption(label: () => string, count: () => number): ComputedRef<string> {
  const { t } = useI18n();
  return computed(() => t('board.stack.caption', { group: label(), n: count() }, count()));
}
