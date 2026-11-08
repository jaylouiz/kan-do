/**
 * @composable useUndoDeleteShortcut
 * @description ⌘Z (macOS) / Ctrl+Z (elsewhere) runs `undo` while a delete is still inside its undo window (#27).
 * Ignored in text fields (native text undo wins), with Shift or Alt (redo, other chords) and when another handler
 * already took the key. Only a handled undo calls `preventDefault`.
 * @responsibility The key handler; which delete is undone lives in `useTaskDeletion.undoLatestDelete`.
 */
import { onBeforeUnmount, onMounted } from 'vue'

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

export function useUndoDeleteShortcut(undo: () => boolean): void {
  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.shiftKey || event.altKey) return
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
    if (isEditable(event.target)) return
    if (undo()) event.preventDefault()
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
