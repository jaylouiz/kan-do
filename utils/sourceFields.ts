/**
 * @module utils/sourceFields
 * @description Which fields of the task form a source supports (#321). The add form derives its rows from the
 * chosen target source, the edit form from the task's own source, so a field a source cannot store is never
 * shown, saved or mirrored to the draft card. Pure: callers pass the Notion property mapping.
 */
import type { NotionCustomPropertyConfig, NotionPropertyMapping } from '~/types/notion'
import type { SourceId } from '~/types/taskSource'
import type { NewValueRules } from '~/lib/quickAddSuggestions'

export interface SourceFields {
  priority: boolean
  timebox: boolean
  activity: boolean
  topic: boolean
  /** Enabled custom properties, shown as the "Eigenschaften" section */
  customProperties: NotionCustomPropertyConfig[]
  /** What a new Thema or Aktivität may look like (#16); `null` = the source has no free values, the new-card flow only searches */
  newValues: NewValueRules | null
}

const LOCAL_FIELDS: SourceFields = {
  priority: true, timebox: true, activity: true, topic: true, customProperties: [],
  // Topics and activities are derived from the tasks: any text is a value
  newValues: { maxLength: null, stripCommas: false },
}

/** Notion creates a select option on the page write; it rejects a comma and keeps 100 characters (checked against the sandbox, #16) */
const NOTION_NEW_VALUES: NewValueRules = { maxLength: 100, stripCommas: true }

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
        newValues: NOTION_NEW_VALUES,
      }
    case 'todoist':
      // What TodoistIntegration maps today: priority, and the project as topic (a new project is not a free value). No connect UI exists yet.
      return { priority: true, timebox: false, activity: false, topic: true, customProperties: [], newValues: null }
    case 'local':
    case null:
      return { ...LOCAL_FIELDS, customProperties: [] }
  }
}
