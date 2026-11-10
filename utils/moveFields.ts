/**
 * @module utils/moveFields
 * @description Which fields of a task a move to another source cannot take along (#322). The count shows as
 * the hint of a "Verschieben nach …" entry; the names are never listed. Pure: callers pass the Notion property
 * mapping. Title, notes, status, position, created date always move, and a Local task holds every field except
 * Notion's custom properties.
 */
import type { NotionPropertyMapping } from '~/types/notion'
import type { Task, TaskCustomEntry } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { fieldsForSource } from '~/utils/sourceFields'
import { DEFAULT_PRIORITY, normalizePriority } from '~/lib/priority'

/** Fields the standard task form cannot show per source are covered by `fieldsForSource`; these three are not form fields. */
interface ExtraFields {
  timeSpent: boolean
  unplanned: boolean
  completedDate: boolean
}

function extraFieldsFor(source: SourceId, mapping: NotionPropertyMapping | null | undefined): ExtraFields {
  switch (source) {
    case 'notion':
      return { timeSpent: !!mapping?.timeSpent, unplanned: !!mapping?.unplanned, completedDate: !!mapping?.completedDate }
    case 'todoist':
      return { timeSpent: false, unplanned: false, completedDate: false }
    case 'local':
      return { timeSpent: true, unplanned: true, completedDate: true }
  }
}

/** Whether `source` holds a task's completion date itself (kd#131: a corrected done day is otherwise kept in Kan-Do only). */
export function sourceStoresCompletedDate(source: SourceId, mapping: NotionPropertyMapping | null | undefined): boolean {
  return extraFieldsFor(source, mapping).completedDate
}

/** Whether a custom property carries a value worth keeping (an empty text, a cleared select, an unchecked box do not). */
export function customEntryHasValue(entry: TaskCustomEntry): boolean {
  const field = entry.value
  switch (field.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return !!field.value
    case 'number':
    case 'select':
    case 'date':
      return field.value !== null
    case 'multi_select':
      return field.value.length > 0
    case 'checkbox':
      return field.value
  }
}

/**
 * Number of fields with a value on `task` that `target` cannot hold. A priority counts when it differs from the
 * default (Normal, #653); a custom entry counts when it has a value and the target maps no enabled property for its key.
 * @param notionMapping The Notion property mapping; without one Notion holds no standard field
 */
export function lostFieldsForMove(
  task: Task,
  target: SourceId,
  notionMapping?: NotionPropertyMapping | null,
): number {
  const fields = fieldsForSource(target, notionMapping)
  const extra = extraFieldsFor(target, notionMapping)
  let lost = 0
  if (!fields.priority && normalizePriority(task.priority) !== DEFAULT_PRIORITY) lost++
  if (!fields.timebox && task.timeBoxSeconds) lost++
  if (!fields.activity && task.activity) lost++
  if (!fields.topic && task.topic) lost++
  if (!extra.timeSpent && task.timeSpentSeconds > 0) lost++
  if (!extra.unplanned && task.isUnplanned) lost++
  if (!extra.completedDate && task.completedAt) lost++
  const heldKeys = new Set(fields.customProperties.map((property) => property.key))
  for (const entry of Object.values(task.custom ?? {})) {
    if (customEntryHasValue(entry) && !heldKeys.has(entry.key)) lost++
  }
  return lost
}
