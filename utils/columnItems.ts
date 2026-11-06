import { COLUMN_ITEM_SELECTOR } from "~/utils/columnItemSelector";
import type { GroupKey } from "~/types/boardGrouping";
import type { ColumnItem } from "~/types/columnItem";
import type { Task } from "~/types/task";
import type { DeletedGap } from "~/types/deletedGap";
import { getRenderedTaskOrder, groupTasksByKey, shouldTaskBeGrouped } from "~/utils/taskGrouping";

/** Whether a node is a draggable item of a column list: a card wrapper or a collapsed stack */
export const isColumnItemNode = (el: Element): boolean => el.matches(COLUMN_ITEM_SELECTOR);

/** Whether a column list holds a draggable item node among its direct children right now */
export const listHasItemNode = (list: Element | null | undefined): boolean =>
  list !== null && list !== undefined && [...list.children].some(isColumnItemNode);

/** The key of a group's header item; a delete gap of the group's first member hangs on it (#438). */
export const stackHeaderKey = (groupKey: string): string => `stack-header:${groupKey}`;

const STACK_HEADER_PREFIX = stackHeaderKey("");

/** Whether an `afterId` is a stack header key (`stackHeaderKey`), not a card or gap id. */
export const isStackHeaderKey = (anchor: string): boolean => anchor.startsWith(STACK_HEADER_PREFIX);

/** The group key inside a header key; the prefix comes off once, group keys may contain `:`. */
export const groupKeyOfHeaderKey = (headerKey: string): string => headerKey.slice(STACK_HEADER_PREFIX.length);

export interface BuildColumnItemsOptions {
  tasks: Task[];
  /** The key the column groups by, null when it is not grouped */
  groupKey: GroupKey | null;
  /** Groups the user has expanded */
  expandedKeys: readonly string[];
  /** Readable group name for a group key */
  groupLabel: (groupKey: string) => string;
  isMuted: (task: Task) => boolean;
  /** `groupTasksByKey(tasks, groupKey)` when the caller already computed it */
  groups?: Map<string, Task[]>;
  /** The gaps of cards deleted inside their undo window that belong to this column (#422) */
  gaps?: DeletedGap[];
}

/** What the order of gaps reads: the task id, the anchor it hangs on and when the delete was requested. */
export type GapOrderInput = Pick<DeletedGap, "taskId" | "afterId" | "requestedAt">;

/**
 * The gaps in the order `placeGaps` lays them out when they share a place: fewer hops through other gaps first, then
 * the older delete. Each entry names the item the gap's chain ends on (`anchor`: an id, a header key, `null` = first,
 * undefined = the column end) and the number of gaps in between (`hops`). A gap whose `afterId` is another gap of the
 * list follows that gap's chain. Since #477 a gap hangs on the item that stood right in front of its card, so the
 * chain is the card order; the hops/`requestedAt` tie-break only orders gaps that still share an anchor (a delete
 * persisted by an older version, a gap re-anchored when its predecessor left). A cycle ends the walk.
 */
export function orderGaps<T extends GapOrderInput>(gaps: T[]): Array<{ gap: T; anchor: string | null | undefined; hops: number }> {
  const byId = new Map(gaps.map((gap) => [gap.taskId, gap]));
  const anchorOf = (gap: T): { anchor: string | null | undefined; hops: number } => {
    let current: T = gap;
    let hops = 0;
    const seen = new Set<string>();
    while (typeof current.afterId === "string" && byId.has(current.afterId) && !seen.has(current.taskId)) {
      seen.add(current.taskId);
      current = byId.get(current.afterId)!;
      hops += 1;
    }
    return { anchor: current.afterId, hops };
  };
  return gaps
    .map((gap) => ({ gap, ...anchorOf(gap) }))
    .sort((a, b) => a.hops - b.hops || a.gap.requestedAt - b.gap.requestedAt);
}

/**
 * Puts each gap (#422) behind the item it followed: `afterId` names a card, a collapsed stack (by any member) or
 * another gap; a gap that follows a gap stays behind it (gaps are chained through `afterId`, so the chain length orders
 * them, and a card that returns from an undo is followed by the gaps that hung on it, #477), `null` = first, and an `afterId` that is not in the list (the card left the column, undefined) means the end.
 *
 * The first member of an expanded stack hangs on its group's header key (`stackHeaderKey`, #438). That anchor
 * resolves to the header item (the gap sits between header and first member), else, with the group collapsed, to
 * the collapsed stack, else, with only one member left (`loneMembers`: group key -> that member's id), directly
 * before that card, which is where the deleted card stood; anything else goes to the end. When the group's last
 * member is deleted, `deleteTaskWithUndo` has already re-pointed the gaps on the header key to the item before the
 * group (#457), so they are ordinary anchors by then; a header key with nothing left (members that left the
 * column some other way) is the column-end fallback.
 */
export function placeGaps(items: ColumnItem[], gaps: DeletedGap[], loneMembers?: ReadonlyMap<string, string>): ColumnItem[] {
  if (gaps.length === 0) return items;
  const indexOfCard = (id: string): number => items.findIndex((item) => item.kind === "card" && item.task.id === id);
  const indexOfAnchor = (anchor: string): number =>
    items.findIndex((item) =>
      (item.kind === "card" && item.task.id === anchor) || (item.kind === "stack" && item.tasks.some((task) => task.id === anchor)),
    );
  /** Where a gap goes: behind `items[index]`, in front of it, or (-1) at the end. */
  const resolve = (anchor: string): { index: number; side: "after" | "before" } => {
    if (isStackHeaderKey(anchor)) {
      const groupKey = groupKeyOfHeaderKey(anchor);
      const header = items.findIndex((item) => item.kind === "stack-header" && item.key === anchor);
      if (header !== -1) return { index: header, side: "after" };
      const collapsed = items.findIndex((item) => item.kind === "stack" && item.groupKey === groupKey);
      if (collapsed !== -1) return { index: collapsed, side: "after" };
      const lone = loneMembers?.get(groupKey);
      return { index: lone === undefined ? -1 : indexOfCard(lone), side: "before" };
    }
    return { index: indexOfAnchor(anchor), side: "after" };
  };
  const placed = orderGaps(gaps);

  const first: ColumnItem[] = [];
  const after = new Map<number, ColumnItem[]>();
  const before = new Map<number, ColumnItem[]>();
  const atEnd: ColumnItem[] = [];
  for (const { gap, anchor } of placed) {
    const item: ColumnItem = { kind: "gap", key: `gap:${gap.taskId}`, gap, itemIndex: 0 };
    if (anchor === null) {
      first.push(item);
      continue;
    }
    const { index, side } = typeof anchor === "string" ? resolve(anchor) : { index: -1, side: "after" as const };
    if (index === -1) atEnd.push(item);
    else {
      const bucket = side === "after" ? after : before;
      bucket.set(index, [...(bucket.get(index) ?? []), item]);
    }
  }
  return [...first, ...items.flatMap((item, index) => [...(before.get(index) ?? []), item, ...(after.get(index) ?? [])]), ...atEnd];
}

/**
 * The column's list, one entry per rendered element, top to bottom. Without grouping every task in
 * order. With grouping: the ungrouped tasks, then each group: a collapsed group of 2+ is one stack,
 * an expanded one is a header row followed by its members as cards (`fromStack` names the group), a
 * single-card group is a card.
 *
 * The header row is not a sortable. `sortableIndex` comes from `getRenderedTaskOrder`, the same
 * order useBoardDndKit maps drops against, so it counts cards and collapsed stacks only and a header
 * never shifts it.
 */
export function buildColumnItems(options: BuildColumnItemsOptions): ColumnItem[] {
  const { tasks, groupKey, expandedKeys, groupLabel, isMuted } = options;
  const groups = groupKey === null ? undefined : (options.groups ?? groupTasksByKey(tasks, groupKey));
  const draggableIds = getRenderedTaskOrder(tasks, groupKey, expandedKeys, groups).draggableIds;
  const indexById = new Map(draggableIds.map((id, index) => [id, index]));
  // An id missing from the rendered order means this list and getRenderedTaskOrder disagree. Index 0
  // would collide with the first sortable, so a stray item goes past the end instead.
  const sortableIndexOf = (id: string): number => {
    const index = indexById.get(id);
    if (index !== undefined) return index;
    if (import.meta.dev) console.warn(`[columnItems] ${id} is not in the rendered task order`);
    return draggableIds.length;
  };
  const card = (
    task: Task,
    member?: { key: string; index: number; size: number; label: string },
  ): ColumnItem => ({
    kind: "card",
    key: task.id,
    task,
    muted: isMuted(task),
    itemIndex: 0,
    sortableIndex: sortableIndexOf(task.id),
    fromStack: member?.key,
    stackPosition: member && (member.index === 0 ? "first" : member.index === member.size - 1 ? "last" : "middle"),
    stackIndex: member && member.index + 1,
    stackSize: member?.size,
    stackLabel: member?.label,
  });

  const items: ColumnItem[] = [];
  if (groupKey === null) {
    items.push(...tasks.map((task) => card(task)));
  } else {
    items.push(...tasks.filter((task) => !shouldTaskBeGrouped(task, groupKey)).map((task) => card(task)));
    for (const [key, members] of groups ?? []) {
      const front = members[0];
      if (front === undefined || members.length < 2) {
        items.push(...members.map((task) => card(task)));
      } else if (expandedKeys.includes(key)) {
        const label = groupLabel(key);
        items.push({
          kind: "stack-header",
          key: stackHeaderKey(key),
          groupKey: key,
          label,
          count: members.length,
          firstTask: front,
          itemIndex: 0,
        });
        items.push(...members.map((task, index) => card(task, { key, index, size: members.length, label })));
      } else {
        items.push({
          kind: "stack",
          key: `stack:${key}`,
          groupKey: key,
          label: groupLabel(key),
          tasks: members,
          muted: !!members[0] && isMuted(members[0]),
          itemIndex: 0,
          sortableIndex: sortableIndexOf(front.id),
        });
      }
    }
  }
  // A group of one card has no header: a gap that hung on that header goes in front of the card (#438)
  const loneMembers = new Map<string, string>();
  for (const [key, members] of groups ?? []) {
    if (members.length === 1) loneMembers.set(key, members[0]!.id);
  }
  return placeGaps(items, options.gaps ?? [], loneMembers).map((item, itemIndex) => ({ ...item, itemIndex }));
}
