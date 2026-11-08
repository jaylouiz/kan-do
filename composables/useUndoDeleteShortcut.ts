/**
 * @composable useUndoDeleteShortcut
 * @description ⌘Z (macOS) / Ctrl+Z (elsewhere) runs `undo` while a delete is still inside its undo window (#27).
 * Ignored in text fields (native text undo wins), inside a dialog or menu, with Shift or Alt (redo, other chords) and when another handler
 * already took the key. Only a handled undo calls `preventDefault`.
 * @responsibility The key handler; which delete is undone lives in `useTaskDeletion.undoLatestDelete`.
 */
import { onBeforeUnmount, onMounted } from 'vue'

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** Focus inside a dialog, sheet or menu: the key belongs to that layer, not to the board behind it. */
function isInsideLayer(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && typeof el.closest === 'function' && !!el.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
}

export function useUndoDeleteShortcut(undo: () => boolean): void {
  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.shiftKey || event.altKey) return
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
    if (isEditable(event.target) || isInsideLayer(event.target)) return
    if (undo()) event.preventDefault()
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
