import { TaskStatus } from "~/types/taskStatus";
import { DEFAULT_PRIORITY } from "~/lib/priority";
import type { CustomPropertyType } from "~/types/notion";
import type { SourceId } from "~/types/taskSource";

export type TaskCustomValue =
  | { type: 'text'; value: string | null }
  | { type: 'number'; value: number | null }
  | { type: 'select'; value: { name: string; color?: string } | null }
  | { type: 'multi_select'; value: Array<{ name: string; color?: string }> }
  | { type: 'date'; value: { start: string; end?: string } | null }
  | { type: 'checkbox'; value: boolean }
  | { type: 'url'; value: string | null }
  | { type: 'email'; value: string | null }
  | { type: 'phone_number'; value: string | null };

export interface TaskCustomEntry {
  /** Stable key (slug) for this custom property */
  key: string;
  /** Original Notion property name (for display) */
  name: string;
  /** Normalized type */
  propType: CustomPropertyType;
  /** Typed value */
  value: TaskCustomValue;
  /** Whether this property is configured but missing from the task */
  isMissing?: boolean;
}

/**
 * Marks a task whose local state the source does not hold yet (#319). State-based: the adapter pushes the
 * task as it is now, so one marker covers any number of changes. Set before the write, cleared when it
 * succeeds, persisted with the task so it survives a restart. Pending time updates are one reason for it.
 */
export interface PendingSync {
  /** When the first unpushed change was made (epoch ms) */
  since: number;
  /** Failed pushes since then */
  attempts: number;
  /** Message of the last failed push; null while none has failed yet */
  lastError: string | null;
  /**
   * Whether the source holds the task as completed (Todoist: a reopen is only sent for a task it holds as
   * completed, #344). Set with the marker from the status the task had before its first unpushed change, so a
   * replay after a restart needs no in-memory state. Absent on a marker written before #344.
   */
  upstreamDone?: boolean;
}

/**
 * A move to another source that did not finish (#322 consumes it): the task already carries the new
 * source, this names where it came from so the old copy can still be removed.
 */
export interface PendingMove {
  fromSource: SourceId;
  fromExternalId: string | null;
  toSource: SourceId;
}

interface Task {
  /**
   * Stable app-level identity. It never changes, not even when the task moves to another source, so
   * statistics, column order, carry-over, archive, timers and routes (all keyed by `id`) need no re-keying.
   * Equals the page id for Notion-born tasks and is generated for Local-born ones. Integrations never
   * receive it: they get `externalId`.
   */
  id: string;
  /** Where the task lives. Changes only together with `externalId`, in one store mutation. */
  source: SourceId;
  /** The id the task's integration knows it by (the Notion page id); `null` for a Local task. */
  externalId: string | null;
  status: TaskStatus;
  title: string;
  activity: string | null;
  topic: string | null;
  topicColorCode: string | null;
  priority: number;
  notes: string | null;
  timeBoxSeconds: number | null;
  timeSpentSeconds: number | 0;
  timerId: number | null;
  /** Additional imported properties from Notion (keyed by stable slug) */
  custom?: Record<string, TaskCustomEntry>;
  /** When task was marked as done */
  completedAt?: Date | null;
  /** When task was created */
  createdAt?: Date | null;
  /** When task was last updated */
  updatedAt?: Date | null;
  /** When task was archived locally (UI-only state) */
  archivedAt?: Date | null;
  /** Whether this task was unplanned (reactive work vs proactive planning) */
  isUnplanned?: boolean;
  /** Unpushed local changes (absent = the source holds the task as it is). A Local task never has one. */
  pendingSync?: PendingSync;
  /** A move to another source that did not finish; always together with `pendingSync` */
  pendingMove?: PendingMove;
}

/**
 * @deprecated TaskClass is unused in the codebase. Use plain objects conforming to Task interface instead.
 * This class will be removed in a future version.
 */
class TaskClass implements Task {
  id: string;
  source: SourceId;
  externalId: string | null;
  status: TaskStatus;
  title: string;
  activity: string | null;
  topic: string | null;
  topicColorCode: string | null;
  priority: number;
  notes: string | null;
  timeBoxSeconds: number | null;
  timeSpentSeconds: number | 0;
  timerId: number | null;
  custom?: Record<string, TaskCustomEntry>;
  completedAt?: Date | null;
  archivedAt?: Date | null;
  isUnplanned?: boolean;
  pendingSync?: PendingSync;
  pendingMove?: PendingMove;

  constructor(title: string) {
    this.id = Math.random().toString(36).substring(7);
    this.source = 'local';
    this.externalId = null;
    this.title = title;
    this.notes = null;
    this.status = TaskStatus.Open;
    this.priority = DEFAULT_PRIORITY;
    this.timeBoxSeconds = null;
    this.timeSpentSeconds = 0;
    this.topic = null;
    this.topicColorCode = null;
    this.activity = null;
    this.timerId = null;
    this.custom = {};
    this.completedAt = null;
    this.archivedAt = null;
    this.isUnplanned = false;
  }
}

// Exporting the type using 'export type' is necessary because we want to export the 'Task' type. 'export default' would export an actual runtime value and TypeScript types are purely a compile-time construct and are never present at runtime.
export { type Task, TaskClass, TaskStatus };
