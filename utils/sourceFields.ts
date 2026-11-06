/**
 * @module utils/sourceFields
 * @description Which fields of the task form a source supports (#321). The add form derives its rows from the
 * chosen target source, the edit form from the task's own source, so a field a source cannot store is never
 * shown, saved or mirrored to the draft card. Pure: callers pass the Notion property mapping.
 */
import type { NotionCustomPropertyConfig, NotionPropertyMapping } from '~/types/notion'
import type { SourceId } from '~/types/taskSource'

export interface SourceFields {
  priority: boolean
  timebox: boolean
  activity: boolean
  topic: boolean
  /** Enabled custom properties, shown as the "Eigenschaften" section */
  customProperties: NotionCustomPropertyConfig[]
}

const LOCAL_FIELDS: SourceFields = { priority: true, timebox: true, activity: true, topic: true, customProperties: [] }

/**
 * @param source The source the task is saved to; `null` (a board that was never set up) behaves like Local
 * @param notionMapping The Notion property mapping; without one Notion offers no standard field
 */
export function fieldsForSource(source: SourceId | null, notionMapping?: NotionPropertyMapping | null): SourceFields {
  switch (source) {
    case 'notion':
      return {
        priority: !!notionMapping?.priority,
        timebox: !!notionMapping?.timeBox,
        activity: !!notionMapping?.activity,
        topic: !!notionMapping?.topic,
        customProperties: notionMapping?.customProperties?.filter((property) => property.enabled) ?? [],
      }
    case 'todoist':
      // What TodoistIntegration maps today: priority, and the project as topic. No connect UI exists yet.
      return { priority: true, timebox: false, activity: false, topic: true, customProperties: [] }
    case 'local':
    case null:
      return { ...LOCAL_FIELDS, customProperties: [] }
  }
}
