/**
 * The classes of a column list's draggable item nodes: a card wrapper (`SortableTaskWrapper`) or a
 * collapsed stack (`TaskStack`). The drag code reads the live DOM by this selector, so it is the one
 * place to change when either root class is renamed.
 */
export const COLUMN_ITEM_SELECTOR = ".task-wrapper, .task-stack";
