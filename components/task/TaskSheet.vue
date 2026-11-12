<!--
@component TaskSheet
@kind block
@category overlay
@description Responsive sheet that hosts the nested task routes (/tasks/:id, /tasks/add, /statistics/:id)
@usage Mounted by TaskSheetHost (pages/tasks.vue and pages/statistics.vue). `open` is driven by the route; closing animates first, then `after-leave` fires so the host can return to its page (/tasks or /statistics).
@avoid Only hosts the nested task routes; other overlays use ResponsiveOverlay directly.
@responsibility
- Hosted by ResponsiveOverlay: a slideover (side right) at >=768px and a bottom drawer below; the shell owns the breakpoint, the frozen variant and the open/close echo guard
- Close: the slideover shows the shell's close button in its top end corner (kd#201: a mouse user finds the way out; the detail header clears it with end padding, `TaskDetailContent`); the drawer has none, a swipe and the dimmed page close it. Escape and an outside press close both as before
- Focus on open (the drawer: ResponsiveOverlay moves it in, #566), focus trap and focus return come from reka's FocusScope
- Detail route: ignores an outside pointer-down in the first moments after it opened: the second click of a double-click on a card lands on the overlay and must not dismiss the sheet (kd#25)
- Keeps Escape inside an active inline editor (and the topic editor, #430) from closing the sheet
- Falls back to the board when there is no trigger to return focus to (deep link)
- After adding a task, focus goes to the saved card instead of the add slot (#125)
-->

<template>
  <ResponsiveOverlay
    :open="open"
    :title="title"
    desktop="slideover"
    :content-props="contentProps"
    :desktop-ui="desktopUi"
    :mobile-ui="mobileUi"
    @update:open="emit('update:open', $event)"
    @after-leave="emit('after-leave')"
  >
    <template #title>
      <span :class="titleClass">{{ title }}</span>
    </template>
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </ResponsiveOverlay>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { SHEET_WIDTH } from '~/utils/modalSizes';
import { useTaskSheet } from '~/composables/useTaskSheet';
import { findSavedCardElement } from '~/utils/focusRecovery';
import ResponsiveOverlay from '~/components/ui/ResponsiveOverlay.vue';

defineOptions({ name: 'TaskSheet' });

// On the board the overlay is transparent on purpose: the board-side backdrop (sheet.css) darkens instead, so the open card stays bright. Must beat the global `overlay` variant scrim (app.config.ts).
// A page without a board (statistics) has no card to spare: the overlay carries the shared scrim itself.
const BOARD_OVERLAY_CLASS = 'task-sheet bg-transparent';
const PAGE_OVERLAY_CLASS = 'task-sheet bg-(--overlay-scrim)';

interface Props {
  /** Whether the sheet is open (driven by the route in the host). */
  open: boolean;
  /** Dialog title. Visible on the add route, screen-reader only on the detail route. */
  title: string;
  /** Detail route: the title is the inline-editable field in the body, so the dialog title is visually hidden. */
  hideTitle?: boolean;
  /** Body padding is owned by the hosted content (detail route). */
  flushBody?: boolean;
  /** The hosting page is not the board: the overlay dims it (the board dims itself, sheet.css). */
  dimsPage?: boolean;
}

const props = withDefaults(defineProps<Props>(), { hideTitle: false, flushBody: false, dimsPage: false });
const { takeReturnFocusTaskId } = useTaskSheet();
const sheetOverlayClass = computed(() => (props.dimsPage ? PAGE_OVERLAY_CLASS : BOARD_OVERLAY_CLASS));

const emit = defineEmits<{
  'update:open': [value: boolean];
  'after-leave': [];
}>();

defineSlots<{
  default(): unknown;
  footer?(): unknown;
}>();

// The sheet header is the display face at medium weight (DESIGN.md): it labels the add-task sheet. The task's own title is set in TaskDetailContent.
const titleClass = computed(() => (props.hideTitle ? 'sr-only' : 'font-display text-lg font-medium tracking-display text-highlighted'));
/**
 * Detail route: the header holds only the visually hidden title, so it takes no space. It is not `sr-only` on the
 * slideover: the shell's close button lives inside the header and `sr-only` would clip it (kd#201). The close button is
 * absolutely positioned in the corner, so a zero-height header still shows it.
 */
const headerClass = computed(() => (props.hideTitle ? 'h-0 min-h-0 border-0 p-0' : undefined));
const bodyClass = computed(() => (props.flushBody ? 'p-0 sm:p-0 min-h-0 overflow-y-auto overscroll-contain' : 'min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6'));
/**
 * Desktop detail: the hosted content owns its scrolling (rows scroll, the metadata is pinned to the
 * bottom edge, #386), so the body is a clipped flex column instead of the scroll container.
 */
const slideoverBodyClass = computed(() => (props.flushBody ? 'p-0 sm:p-0 min-h-0 flex flex-col overflow-hidden' : bodyClass.value));

const desktopUi = computed(() => ({
  overlay: sheetOverlayClass.value,
  content: `task-sheet ${SHEET_WIDTH}${props.hideTitle ? ' divide-y-0' : ''}`,
  header: headerClass.value,
  body: slideoverBodyClass.value,
  footer: 'sheet-footer',
}));
const mobileUi = computed(() => ({
  overlay: sheetOverlayClass.value,
  content: 'task-sheet',
  header: props.hideTitle ? 'sr-only' : 'px-4 pb-2',
  body: bodyClass.value,
  footer: 'sheet-footer border-t border-default p-4',
}));

/**
 * Escape inside a text field cancels that field only when there is something to lose:
 * an active inline editor (detail route) or a field with a typed draft (add route).
 * reka listens on the document, so stopPropagation in the field is too late;
 * the field's own keydown handler still runs because we only veto the dialog's dismissal.
 */
const isGuardedField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
  if (!field) return false;
  if (field.closest('[data-inline-editable]')) return true;
  const value = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.textContent;
  return (value ?? '').trim() !== '';
};

const onEscapeKeyDown = (event: KeyboardEvent) => {
  // The topic editor (#430) handles Escape itself: it closes, the sheet stays
  if (isGuardedField(event.target) || (event.target instanceof HTMLElement && event.target.closest('[data-topic-editor]'))) event.preventDefault();
};

const findSavedCard = findSavedCardElement; // shared with the in-card add flow (#649)

/**
 * Focus returns to the card that opened the sheet (reka's FocusScope remembers it).
 * A deep link has no such trigger: send focus to the board instead of letting it fall to <body>.
 * The temporary tabindex is removed on blur, so the board does not stay a click-focus target.
 */
let opener: Element | null = null;
/** `performance.now()` of the last open; the double-click guard below reads it. */
let openedAt = Number.NEGATIVE_INFINITY;
watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  openedAt = performance.now();
  opener = document.activeElement;
  // A save target left over from a close that never reached onCloseAutoFocus must not steer this one
  takeReturnFocusTaskId();
}, { flush: 'sync' });

const onCloseAutoFocus = (event: Event) => {
  // After a save, focus goes to the card that was just added (#125): the new card in Offen,
  // the current card in Jetzt.
  const savedTaskId = takeReturnFocusTaskId();
  const savedCard = savedTaskId ? findSavedCard(savedTaskId) : null;
  if (savedCard) {
    event.preventDefault();
    savedCard.focus({ preventScroll: true });
    return;
  }
  // An add slot that re-rendered while the form was open (#110, #125) leaves the remembered opener
  // detached: focus the slot of the same column instead.
  if (opener instanceof HTMLElement && !opener.isConnected && opener.classList.contains('add-task-button')) {
    const replacement = document.querySelector<HTMLElement>(`.add-task-button[data-add-slot="${opener.dataset.addSlot ?? ''}"]`);
    if (replacement) {
      event.preventDefault();
      replacement.focus({ preventScroll: true });
      return;
    }
  }
  if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) return;
  const board = document.querySelector<HTMLElement>('[data-task-sheet-return]');
  if (!board) return;
  event.preventDefault();
  board.setAttribute('tabindex', '-1');
  board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true });
  board.focus({ preventScroll: true });
};

/**
 * Detail route: focus the sheet itself instead of the first control (the inline title),
 * so opening does not drop straight into an edit trigger with a focus ring. Tab starts at the title.
 * The add route keeps the default, its form focuses the title field.
 */
const onOpenAutoFocus = (event: Event) => {
  if (!props.hideTitle) return;
  event.preventDefault();
  if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
};

/**
 * A card opens on click (kd#25). A person double-clicking it sends the second press 80-400 ms later, when the sheet's
 * overlay is already over the card: reka reads that as a press outside and would dismiss the sheet. Within the OS
 * double-click interval of the open (detail route), an outside press is that second click and is swallowed; later ones dismiss as usual.
 */
const DOUBLE_CLICK_GUARD_MS = 600;
const onPointerDownOutside = (event: Event) => {
  // Detail route only (`hideTitle`): the add route is not opened by a card click
  if (props.hideTitle && performance.now() - openedAt < DOUBLE_CLICK_GUARD_MS) event.preventDefault();
};

const contentProps = { onOpenAutoFocus, onEscapeKeyDown, onCloseAutoFocus, onPointerDownOutside };
</script>
