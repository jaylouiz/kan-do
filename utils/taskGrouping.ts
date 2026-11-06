import type { GroupKey } from "~/types/boardGrouping";
import type { Task, TaskCustomEntry } from "~/types/task";
import { TaskStatus } from "~/types/taskStatus";
import { getActiveLocale, translate } from "~/lib/i18n";
import { formatDateTime } from "~/utils/localeFormat";
import { getPriorityLabel } from "~/utils/taskStatusMappings";
import { normalizePriority } from "~/lib/priority";

export const EMPTY_GROUP_KEY = "__EMPTY__";

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : EMPTY_GROUP_KEY;
}

function normalizeNumber(value: number | null | undefined): string {
  return value !== null && value !== undefined ? String(value) : EMPTY_GROUP_KEY;
}

function normalizeBoolean(value: boolean | undefined): string {
  if (value === undefined) return EMPTY_GROUP_KEY;
  return value ? "true" : "false";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A full ISO datetime with an explicit `Z` or `±hh:mm` / `±hhmm` offset: the only spelling that names one instant
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Group key of a date value. A value with a time is an instant, so its offset spelling must not
 * split a group: `…T09:00:00Z` and `…T11:00:00+02:00` share the ISO key. Everything else (date-only,
 * offset-less datetimes, junk, invalid dates) stays as written, without `new Date`: its parsing of
 * such strings differs per browser and timezone (it is the label then, see getGroupLabel).
 */
function canonicalDateKey(key: string): string {
  if (!ISO_INSTANT.test(key)) return key;
  const time = new Date(key).getTime();
  return Number.isNaN(time) ? key : new Date(time).toISOString();
}

function extractFromCustomEntry(entry: TaskCustomEntry | undefined): string {
  if (!entry) return EMPTY_GROUP_KEY;
  const { value } = entry;
  switch (value.type) {
    case "text":
      return normalizeText(value.value);
    case "number":
      return normalizeNumber(value.value);
    case "select": {
      const selectValue = value.value as { name: string; color?: string } | null;
      return normalizeText(selectValue?.name ?? null);
    }
    case "multi_select":
      // Multi-select properties are not supported for grouping (ambiguous which group a task belongs to)
      return EMPTY_GROUP_KEY;
    case "date": {
      const dateValue = value.value as { start: string; end?: string } | null;
      return canonicalDateKey(normalizeText(dateValue?.start ?? dateValue?.end ?? null));
    }
    case "checkbox":
      return normalizeBoolean(value.value);
    case "url":
    case "email":
    case "phone_number":
    default:
      return EMPTY_GROUP_KEY;
  }
}

export function deriveGroupKeyForTask(task: Task, groupKey: GroupKey): string {
  switch (groupKey) {
    case "topic":
      return normalizeText(task.topic);
    case "activity":
      return normalizeText(task.activity);
    case "priority":
      // The former 4th level (urgent) shares the High group (#617); no priority is Normal (#653)
      return String(normalizePriority(task.priority));
    default: {
      if (!groupKey.startsWith("custom:")) {
        return EMPTY_GROUP_KEY;
      }
      const slug = groupKey.slice(7);
      const entry = task.custom?.[slug];
      return extractFromCustomEntry(entry);
    }
  }
}

/** A date-only value is a calendar day (UTC, as Notion stores it); one with a time is an instant */
function formatGroupDate(start: string): string {
  const locale = getActiveLocale();
  return DATE_ONLY.test(start)
    ? formatDateTime(start, locale, "longDateUtc")
    : formatDateTime(start, locale, "mediumDateShortTime");
}

/**
 * Human-readable name of a group, for the stack's caption, header row, accessible name and
 * announcements. The key is a normalized string (ISO date, "true"/"false"), so the value is read
 * from the group's first task and formatted by its type: a date is localized, a checkbox reads
 * "<Property>: Yes/No". Text, number and select are the key itself. Priority names the level
 * (Niedrig, Normal, Hoch; there is no "none" priority, #653); the empty group of any other grouping is "none".
 */
export function getGroupLabel(groupKey: string, by: GroupKey | null, firstTask?: Task): string {
  if (groupKey === EMPTY_GROUP_KEY) return translate("priority.none");
  if (by === "priority") return getPriorityLabel(Number(groupKey));
  if (by?.startsWith("custom:")) {
    const entry = firstTask?.custom?.[by.slice(7)];
    const value = entry?.value;
    if (entry && value?.type === "date") {
      const start = value.value?.start ?? value.value?.end;
      // formatDateTime would answer "Invalid Date" for a malformed value; the key is the raw string
      if (start) return Number.isNaN(new Date(start).getTime()) ? groupKey : formatGroupDate(start);
    }
    if (entry && value?.type === "checkbox") {
      return translate(value.value ? "board.stack.checkboxYes" : "board.stack.checkboxNo", { property: entry.name });
    }
  }
  return groupKey;
}

/**
 * Determines if a task should be grouped based on the grouping key.
 * Tasks with empty values are NOT grouped, except for priority, which every task has (no value reads as Normal, #653).
 */
export function shouldTaskBeGrouped(task: Task, groupKey: GroupKey): boolean {
  const derivedKey = deriveGroupKeyForTask(task, groupKey);
  
  // Priority is special: every task has one
  if (groupKey === "priority") {
    return true;
  }
  
  // All other properties: exclude tasks with empty values from grouping
  return derivedKey !== EMPTY_GROUP_KEY;
}

/**
 * Groups tasks by the specified property key.
 * Returns a Map where each key is a group identifier (e.g., "High", "Work") and
 * the value is an array of tasks belonging to that group.
 * Preserves original task order within each group.
 * 
 * Tasks without a value for the grouping property are excluded from grouping
 * (except for priority, which every task has).
 */
export function groupTasksByKey(tasks: Task[], groupKey: GroupKey): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>();

  tasks.forEach((task) => {
    // Skip tasks that shouldn't be grouped
    if (!shouldTaskBeGrouped(task, groupKey)) {
      return;
    }
    
    const key = deriveGroupKeyForTask(task, groupKey);
    const list = grouped.get(key) ?? [];
    list.push(task);
    grouped.set(key, list);
  });

  return grouped;
}

/**
 * Whether a column groups its tasks. Jetzt is never grouped (it holds at most one task).
 */
export function isGroupingActiveFor(
  status: TaskStatus,
  enabled: boolean,
  groupKey: GroupKey | null,
): boolean {
  return enabled && groupKey !== null && status !== TaskStatus.Progress;
}

export interface RenderedTaskOrder {
  /** Tasks top to bottom as the column renders them */
  rendered: Task[];
  /**
   * Ids of the sortables, top to bottom: cards, and a collapsed stack by its front task (#150).
   * The other members of a collapsed stack are not sortables.
   */
  draggableIds: string[];
}

/** Group keys of the stacks a column renders: groups of 2+ tasks. */
export function getStackKeys(
  tasks: Task[],
  groupKey: GroupKey | null,
  groups?: Map<string, Task[]>,
): string[] {
  if (groupKey === null) return [];
  return [...(groups ?? groupTasksByKey(tasks, groupKey))]
    .filter(([, members]) => members.length >= 2)
    .map(([key]) => key);
}

/**
 * A column's rendered order and its draggable cards (#135). Without a group key that is the
 * input order. With one: ungrouped tasks first (input order), then each group in order of its
 * first task, members contiguous. A group of 2+ renders as a collapsed stack, which is one sortable
 * with its front task's id (#150; its other members are not sortables), unless its key is in
 * `expandedKeys`: then its members render as ordinary cards in place of the stack (#147).
 * Ungrouped tasks and single-card groups are always draggable.
 * Built on the same helpers as the BoardColumn template. `groups` is `groupTasksByKey(tasks,
 * groupKey)` when the caller already computed it (BoardColumn does once per update).
 */
export function getRenderedTaskOrder(
  tasks: Task[],
  groupKey: GroupKey | null,
  expandedKeys: readonly string[] = [],
  groups?: Map<string, Task[]>,
): RenderedTaskOrder {
  if (groupKey === null) {
    return { rendered: [...tasks], draggableIds: tasks.map(task => task.id) };
  }
  const ungrouped = tasks.filter(task => !shouldTaskBeGrouped(task, groupKey));
  const entries = [...(groups ?? groupTasksByKey(tasks, groupKey))];
  const draggable = entries.flatMap(([key, members]) =>
    members.length === 1 || expandedKeys.includes(key) ? members : members.slice(0, 1));
  return {
    rendered: [...ungrouped, ...entries.flatMap(([, members]) => members)],
    draggableIds: [...ungrouped, ...draggable].map(task => task.id),
  };
}
