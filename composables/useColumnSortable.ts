import { nextTick, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { Feedback } from '@dnd-kit/dom'
import { useSortable, type UseSortableInput } from '@dnd-kit/vue/sortable'
import { useBoardDragState } from '~/composables/useBoardDragState'
import type { TaskStatus } from '~/types/taskStatus'

/** Plugin list accepted by a sortable (`Plugins` from @dnd-kit/abstract, a transitive dependency). */
type SortablePlugins = Extract<UseSortableInput['plugins'], unknown[]>

/**
 * Since dnd-kit 0.4, clone feedback is configured per entity via the Feedback plugin.
 * Extends (not replaces) the default sortable plugins so keyboard and optimistic
 * sorting keep working.
 */
const withCloneFeedback = (defaults: SortablePlugins): SortablePlugins => [
  ...defaults,
  Feedback.configure({ feedback: 'clone' }),
]

export interface ColumnSortableOptions {
  /** Entity data, read by useBoardDndKit and the announcements (a collapsed stack passes `{ stack }`, #150) */
  data?: MaybeRefOrGetter<Record<string, unknown>>
  /** Element that starts a drag and takes focus and keyboard input instead of the element itself */
  handle?: Ref<HTMLElement | null>
}

/**
 * Per-item sortable composable for board task cards and collapsed stacks.
 * Each task wrapper (and each TaskStack) calls this to register itself with the dnd-kit DragDropManager.
 * When a drag of the item ends it resets the sortable to its own column and index (#424).
 *
 * @param taskId   - Unique task identifier (used as dnd-kit item id); a stack passes its front task's
 *                   id as a getter, so the id follows the front card
 * @param index    - Reactive index within its column list
 * @param status   - Column status used as the sortable group identifier
 * @param element  - Template ref for the draggable DOM element
 * @param options  - `data` and `handle` (stacks, #150)
 */
export function useColumnSortable(
  taskId: MaybeRefOrGetter<string>,
  index: Ref<number>,
  status: TaskStatus,
  element: Ref<HTMLElement | null>,
  options: ColumnSortableOptions = {},
) {
  const { sortable, isDragging, isDropTarget, isDragSource } = useSortable({
    id: taskId,
    index,
    group: status,
    element,
    ...(options.handle ? { handle: options.handle } : {}),
    ...(options.data ? { data: options.data } : {}),
    // Wrapped in a getter: the Vue binding resolves every input with toValue(),
    // which would otherwise call the customizer itself without the defaults.
    plugins: () => withCloneFeedback,
    transition: {
      duration: 200,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      idle: false,
    },
  })

  // A drag that ends without remounting the wrapper (a drop back over the origin, a cancel) leaves
  // the sortable in the last column it was sorted into: @dnd-kit/vue copies `group` and `index` from
  // the input only when the input changes, and both are constant here (#424). The next drag would
  // read that column as its origin. Reset them once the app's drag state says the drag is over
  // (`onDragEnd` ran and read them) and Vue rendered the drop, so `index` is the one the prop holds
  // then (a same-column reorder changed it). A sortable that never left its slot is untouched.
  const { dragState } = useBoardDragState()
  watch(() => dragState.value.isDragging, async (dragging, wasDragging) => {
    if (dragging || !wasDragging) return
    await nextTick()
    if (sortable.value.group !== status) sortable.value.group = status
    if (sortable.value.index !== index.value) sortable.value.index = index.value
  })

  return {
    isDragging,
    isDropTarget,
    isDragSource,
  }
}
