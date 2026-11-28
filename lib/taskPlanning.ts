/**
 * @module lib/taskPlanning
 * @description Whether a task is planned for today, i.e. on the board (#353, epic #334).
 *
 * A task is planned ("Für heute eingeplant") unless it carries `notPlanned: true` and its status is Open or Waiting
 * (#793, epic #374: the marker stands beside the status, so a waiting task can leave today and keep waiting). A Jetzt
 * task is always planned and a done task ignores the marker. The marker is kan-do's own state and additive: data
 * stored before #353 has no marker, so every older task reads as planned. A connection that has a planning state of
 * its own (#357: Notion with "not planned" statuses mapped) is followed only when that state changes there
 * (`Task.sourceNotPlanned`, the rule is in `tasksStore.mergeTasks`).
 */
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import type { SourceId } from '~/types/taskSource'
import { sourcePlansByDate } from '~/lib/taskSources'

/** Whether a task in `status` can be off today: Offen and Wartet. Jetzt always belongs to today, Erledigt to its done day. */
export function canBeOffToday(status: TaskStatus): boolean {
  return status === TaskStatus.Open || status === TaskStatus.Waiting
}

/**
 * The single reader of `Task.notPlanned`. Strict on purpose: any other stored value (`false`, `null`, a
 * string from a damaged file) reads as planned, and so does a marker left on a Jetzt or Erledigt task, so a task
 * can never be hidden by a stale marker.
 */
export function isNotPlanned(task: Pick<Task, 'notPlanned' | 'status'>): boolean {
  return task.notPlanned === true && canBeOffToday(task.status)
}

/**
 * The one rule for a marker across a status write (#353, #793): it survives only between Offen and Wartet (either
 * way, or staying). Jetzt sets "planned" (starting a task plans it), and so does the way back from Erledigt. Every
 * writer of a status (`updateTask`, the batch move, `mergeTasks`, `inStatus`) asks here.
 */
export function markerSurvives(before: TaskStatus, after: TaskStatus): boolean {
  return canBeOffToday(before) && canBeOffToday(after)
}

/**
 * The rule for `Task.sourceNotPlanned` across one of kan-do's own status writes (#357): it survives only on a task
 * that was Open and stays Open. The write of any other status tells the source the column, so it no longer holds the
 * task as not planned (an Offen task off today moved to Wartet is written with its waiting status), and a later
 * put-back must write again.
 *
 * A source that plans by date (#553, `sourcePlansByDate`: Reminders) holds no status for planning: the value is what the
 * date said, and no status write changes the date. It survives with the marker (`markerSurvives`, #793), so a reminder off
 * today moved to Wartet still joins the board on its due day; a move to Jetzt or Erledigt plans the task, and a planned
 * card holds no value, as after the user's plan.
 */
export function sourceHoldSurvives(source: SourceId, before: TaskStatus, after: TaskStatus): boolean {
  if (sourcePlansByDate(source)) return markerSurvives(before, after)
  return before === TaskStatus.Open && after === TaskStatus.Open
}

/**
 * A copy of `task` in `status` (a restore or an undo that puts a Jetzt task back into Offen). The marker stays
 * only by `markerSurvives`: a snapshot from Jetzt or Erledigt may carry a stale one (an older app version moved the
 * task on), and in Offen that marker would hide the task (#354).
 */
export function inStatus<T extends Pick<Task, 'notPlanned' | 'sourceNotPlanned' | 'status' | 'source'>>(task: T, status: TaskStatus): T {
  const { notPlanned, sourceNotPlanned, ...rest } = task
  return {
    ...rest,
    status,
    ...(markerSurvives(task.status, status) && notPlanned === true ? { notPlanned: true as const } : {}),
    ...(sourceHoldSurvives(task.source, task.status, status) && sourceNotPlanned !== undefined ? { sourceNotPlanned } : {}),
  } as T
}

/**
 * The stamp `tasks-store.markerModel` carries once `notPlanned` counts on a Wartet task too (#793). Stored data
 * without it is from before: `dropStaleMarkers` runs on it once.
 */
export const MARKER_MODEL = 2

/**
 * The first load of data stored before #793 (UX decision 6A, no rewrite): until then the marker counted on an Open
 * task only, so one left on a Jetzt, Wartet or Erledigt task had no effect. It is dropped there, whatever its value,
 * so the board and "Alle Aufgaben" look the same after the update. An Open task keeps its field as it is. Returns the
 * input array itself when no task changed. The task snapshots of `trash-store` are not cleaned. A seed that holds a
 * waiting task off today must write the `MARKER_MODEL` stamp (`plugins/e2e-seed.client.ts`).
 */
export function dropStaleMarkers<T>(tasks: T[]): T[] {
  let changed = false
  const next = tasks.map((task) => {
    if (typeof task !== 'object' || task === null || !('notPlanned' in task)) return task
    if ((task as { status?: unknown }).status === TaskStatus.Open) return task
    changed = true
    const { notPlanned: _stale, ...rest } = task as T & { notPlanned?: unknown }
    return rest as T
  })
  return changed ? next : tasks
}

/** The tasks that are on today's board: what every "board" reader works on. */
export function plannedTasks<T extends Pick<Task, 'notPlanned' | 'status'>>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !isNotPlanned(task))
}
