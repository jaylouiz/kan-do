import { ref } from 'vue'
import type { TaskStatus } from '~/types/taskStatus'

/** A collapsed stack picked up as a whole (#150), as it was when the drag started */
export interface DraggedStack {
  /** Group key of the stack */
  key: string
  /** Readable group name, as in the caption */
  label: string
  /** Every member, in render order; the first is the front card and the sortable's id */
  taskIds: string[]
}

export interface DragState {
  isDragging: boolean
  /** The dragged card, or the front card of a dragged stack */
  draggedTaskId: string | null
  /** Set while a whole collapsed stack is dragged; null for a single card */
  draggedStack: DraggedStack | null
  /** TaskStatus of the column the dragged task originated from */
  sourceStatus: TaskStatus | null
  /** TaskStatus of the column currently being hovered over */
  hoverTargetStatus: TaskStatus | null
  /** True when drop is blocked by WIP limit (Progress column full) */
  isDropBlocked: boolean
}

// Global drag state to allow communication between column instances
const dragState = ref<DragState>({
  isDragging: false,
  draggedTaskId: null,
  draggedStack: null,
  sourceStatus: null,
  hoverTargetStatus: null,
  isDropBlocked: false,
})

export function useBoardDragState() {
  return {
    dragState
  }
}
