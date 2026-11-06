/**
 * @composable useHeldWhileDragging
 * @description Follows a source ref except while a board drag runs: the value is frozen at its pre-drag state
 * and catches up on drop. Keeps a notice that appears or disappears on its own from moving the board under a
 * dragged card (the DragOverlay is viewport-fixed, see `.claude/rules/drag-and-drop.md`).
 * @responsibility
 * - Returns a read-only ref that equals `source` whenever no drag is active
 */
import { readonly, ref, watch, type Ref } from 'vue'
import { useBoardDragState } from '~/composables/useBoardDragState'

export function useHeldWhileDragging<T>(source: Ref<T>) {
  const { dragState } = useBoardDragState()
  const held = ref(source.value) as Ref<T>
  watch(
    [source, () => dragState.value.isDragging],
    ([value, dragging]) => {
      if (!dragging) held.value = value
    },
    { flush: 'sync' },
  )
  return readonly(held)
}
