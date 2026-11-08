import type { Task, TaskCustomEntry, TaskCustomValue } from "~/types/task";
import { TaskStatus } from "~/types/task";
import type {
  NotionPropertyMapping,
  NotionStatusMapping,
  NotionPriorityMapping,
  LegacyNotionPriorityMapping,
  CustomPropertyType,
  NotionDatabaseSummary,
  NotionDatabaseSchema,
} from "~/types/notion";
import { parseTimeValue } from "~/utils/common";
import { externalIdOf } from "~/lib/taskSources";
import { cleanNewValue } from "~/lib/quickAddSuggestions";
import { fieldsForSource } from "~/utils/sourceFields";
import { DEFAULT_PRIORITY, normalizePriority, normalizePriorityMapping, notionNameToPriority, priorityToNotionName } from "~/lib/priority";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { NotionClientAPI } from './NotionClientAPI';


// Define a type for Notion page results
interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, {
    title?: Array<{ plain_text?: string }>;
    select?: { name?: string; color?: string };
    /** Notion's native Status property (#312); read like `select` for the mapped status column. */
    status?: { name?: string; color?: string } | null;
    multi_select?: Array<{ name?: string }>;
    date?: { start?: string };
    number?: number;
    checkbox?: boolean;
    rich_text?: Array<{ plain_text?: string; text?: { content?: string } }>;
    url?: string | null;
    email?: string | null;
    phone_number?: string | null;
  }>;
}

// Define a type for Notion property values that can contain time information
interface NotionTimeProperty {
  number?: number;
  select?: { name?: string };
  rich_text?: Array<{ text?: { content?: string } }>;
  title?: Array<{ plain_text?: string } | { text?: { content?: string } }>;
}

type NotionTopicProperty = {
  select?: { name?: string | null; color?: string | null } | null;
  multi_select?: Array<{ name?: string | null; color?: string | null }> | null;
  rich_text?: Array<{ plain_text?: string | null; text?: { content?: string | null } | null }> | null;
  title?: Array<{ plain_text?: string | null; text?: { content?: string | null } | null }> | null;
  plain_text?: string | null;
};

/** Property types Notion accepts for the mapped status column. */
type StatusPropertyType = 'select' | 'status';

/**
 * Detected type of the mapped status property per `${dataSourceId}:${propertyName}`, for the app
 * session (#312). Holds the pending read too, so concurrent first calls share one request; a
 * failed read is removed again and retried by the next call. Nothing is persisted.
 */
const statusTypeCache = new Map<string, Promise<StatusPropertyType>>();

/** Property types a topic or activity can be written in (kd#16): Notion rejects a value of the wrong shape with a 400 */
type LabelPropertyType = 'select' | 'multi_select' | 'rich_text';

/**
 * Property types of a data source's schema per data source id, for the app session (kd#16): which shape a topic or
 * activity is written in. Holds the pending read; a failed read is removed again and retried by the next create.
 */
const schemaTypeCache = new Map<string, Promise<Record<string, string | undefined>>>();

/** Forgets every detected property type (unit tests). */
export const resetStatusTypeCache = (): void => {
  statusTypeCache.clear();
  schemaTypeCache.clear();
};

export class NotionIntegration {
  private apiToken: string;
  private api: NotionClientAPI;
  private databaseId: string;
  private dataSourceId: string | null;
  private propertyMapping: NotionPropertyMapping;
  private statusMapping: NotionStatusMapping;
  private priorityMapping?: NotionPriorityMapping;

  /**
   * Resolves whether the mapped status property is a native Notion `status` or a `select`, from the
   * data source schema (memoized per data source and property, see `statusTypeCache`). Falls back
   * to `select` without a data source or when the schema read fails; the failure is neither
   * reported nor memoized, so the sync behaves as before this detection and the next call retries.
   */
  private async statusPropertyType(): Promise<StatusPropertyType> {
    const dataSourceId = this.dataSourceId;
    if (!dataSourceId) return 'select';

    const propertyName = this.propertyMapping.status;
    const key = `${dataSourceId}:${propertyName}`;
    const cached = statusTypeCache.get(key);
    // Concurrent callers share one read; each falls back to select if it fails.
    if (cached) return cached.catch((): StatusPropertyType => 'select');

    const pending = this.api.getDataSource(dataSourceId).then((dataSource): StatusPropertyType => {
      const type = dataSource.properties?.[propertyName]?.type;
      if (type === 'status') return 'status';
      // Only a definite answer is memoized: a schema without the mapped property stays unknown.
      if (type === undefined) throw new Error(`Status property "${propertyName}" not found in data source schema`);
      return 'select';
    });
    statusTypeCache.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (statusTypeCache.get(key) === pending) statusTypeCache.delete(key);
      if (import.meta.dev) {
        console.warn('[NotionIntegration] Status property type unknown, assuming select:', error);
      }
      return 'select';
    }
  }

  /**
   * The type of a mapped topic or activity property (`select`, `multi_select`, `rich_text`) from the data source
   * schema, or `null` when it cannot be told (no data source, the read failed, another type): the caller then writes
   * its default shape, as before this detection. The failure is neither reported nor memoized.
   */
  private async labelPropertyType(propertyName: string): Promise<LabelPropertyType | null> {
    const dataSourceId = this.dataSourceId;
    if (!dataSourceId) return null;
    let pending = schemaTypeCache.get(dataSourceId);
    if (!pending) {
      pending = this.api.getDataSource(dataSourceId).then((dataSource) => {
        const types: Record<string, string | undefined> = {};
        for (const [name, definition] of Object.entries(dataSource.properties ?? {})) types[name] = definition?.type;
        return types;
      });
      schemaTypeCache.set(dataSourceId, pending);
    }
    try {
      const type = (await pending)[propertyName];
      return type === 'select' || type === 'multi_select' || type === 'rich_text' ? type : null;
    } catch (error) {
      if (schemaTypeCache.get(dataSourceId) === pending) schemaTypeCache.delete(dataSourceId);
      if (import.meta.dev) console.warn('[NotionIntegration] Property type unknown, writing the default shape:', error);
      return null;
    }
  }

  /** A topic or activity as the property's own type holds it: a select or multi_select takes the name (Notion creates a new option on the write), rich text takes the text. An empty value clears the property. */
  private labelValue(type: LabelPropertyType, value: string | null | undefined): Record<string, unknown> {
    const name = value?.trim() || null;
    switch (type) {
      case 'select': return { select: name ? { name } : null };
      case 'multi_select': return { multi_select: name ? [{ name }] : [] };
      case 'rich_text': return { rich_text: name ? [{ text: { content: name } }] : [] };
    }
  }

  /**
   * Puts a topic or activity into `target` when it differs from what the page holds (kd#39): names compared trimmed
   * and case-insensitive, an empty local value against a held one clears it. The write shape is the property's own
   * type (`labelPropertyType`), `fallbackType` when it cannot be told, as `createTask` does.
   */
  private async writeChangedLabel(
    target: Record<string, unknown>,
    heldProperties: Record<string, unknown> | undefined,
    propertyName: string,
    value: string | null | undefined,
    fallbackType: LabelPropertyType,
  ): Promise<void> {
    const heldProperty = heldProperties?.[propertyName] as NotionTopicProperty | undefined;
    const held = this.readTopicProperty(heldProperty).text?.trim() || null;
    const same = (a: string | null, b: string | null) => (a?.toLowerCase() ?? null) === (b?.toLowerCase() ?? null);
    if (same(held, value?.trim() || null)) return; // nothing to write: no schema read
    const type = (await this.labelPropertyType(propertyName)) ?? fallbackType;
    // A select or multi_select option name takes the source's rules (no comma, 100 characters), as the new-card flow cleans it
    let wanted = value?.trim() || null;
    if (wanted && type !== 'rich_text') wanted = cleanNewValue(wanted, fieldsForSource('notion').newValues!) || null;
    if (same(held, wanted)) return;
    // A multi-value Aktivität reads as "A, B" (several options): a local label with a comma is that flattened text, possibly
    // stale, and no option name. Writing it would be one option that Notion rejects, so leave the property alone.
    const heldCount = (heldProperty as { multi_select?: unknown[] } | undefined)?.multi_select?.length ?? 0;
    if (heldCount > 1 && value?.includes(',')) return;
    target[propertyName] = this.labelValue(type, wanted);
  }

  /** `{ property, select|status: { equals } }`: one status filter condition for the detected type. */
  private statusFilter(type: StatusPropertyType, name: string) {
    return type === 'status'
      ? { property: this.propertyMapping.status, status: { equals: name } }
      : { property: this.propertyMapping.status, select: { equals: name } };
  }

  /** `{ select|status: { name } }`: the write value for the mapped status property. */
  private statusValue(type: StatusPropertyType, name: string): { select: { name: string } } | { status: { name: string } } {
    return type === 'status' ? { status: { name } } : { select: { name } };
  }

  private mapNotionStatus(notionStatus: string): TaskStatus {
    const statusMap: Record<string, TaskStatus> = {
      [this.statusMapping.today]: TaskStatus.Open,
      [this.statusMapping.doing]: TaskStatus.Progress,
      [this.statusMapping.waiting || "Waiting"]: TaskStatus.Waiting,
      [this.statusMapping.done]: TaskStatus.Done,
    };
    if (this.statusMapping.archive) {
      statusMap[this.statusMapping.archive] = TaskStatus.Done;
    }
    return statusMap[notionStatus] ?? TaskStatus.Open;
  }

  /**
   * Parses time value from various Notion property types (for formatted strings)
   * @param property The Notion property that might contain time information
   * @returns Time value in seconds or null if not parseable
   */
  private parseTimeValue(property: NotionTimeProperty | null | undefined): number | null {
    if (!property) return null;

    // Helper function to safely extract text content from title property
    const getTitleContent = (titleItem: { plain_text?: string } | { text?: { content?: string } }) => {
      if ('plain_text' in titleItem && titleItem.plain_text) {
        return titleItem.plain_text;
      } else if ('text' in titleItem && titleItem.text?.content) {
        return titleItem.text.content;
      }
      return null;
    };

    // Get the raw value, regardless of property type
    const rawValue =
      property.number?.toString() || // number property
      property.select?.name || // select property
      property.rich_text?.[0]?.text?.content || // rich text property
      (property.title?.[0] ? getTitleContent(property.title[0]) : null) || // title property
      null;

    return parseTimeValue(rawValue);
  }

  /**
   * Parses timeBox value from Notion property based on configured unit.
   * @param property The Notion property containing timeBox data
   * @param unit The configured unit for the timeBox field
   * @returns Time value in seconds or null if not parseable
   */
  private parseTimeBoxValue(
    property: NotionTimeProperty | null | undefined,
    unit: 'seconds' | 'minutes' | 'hours' | 'formatted' | undefined
  ): number | null {
    if (!property) return null;

    // Default to 'formatted' for backward compatibility
    const effectiveUnit = unit ?? 'formatted';

    if (effectiveUnit === 'formatted') {
      // Use the existing parseTimeValue for formatted strings like "15 min", "2h"
      return this.parseTimeValue(property);
    }

    // For numeric units, extract the number value
    const numValue = typeof property.number === 'number' ? property.number : null;
    if (numValue === null) {
      // Fallback to formatted parsing if no number found
      return this.parseTimeValue(property);
    }

    // Convert to seconds based on unit
    return this.toSecondsFromUnit(numValue, effectiveUnit);
  }

  private extractPlainText(items?: Array<{ plain_text?: string | null; text?: { content?: string | null } | null }>): string | null {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      if (!item) continue;
      if (typeof item.plain_text === 'string' && item.plain_text.trim().length > 0) {
        return item.plain_text;
      }
      const content = item.text?.content;
      if (typeof content === 'string' && content.trim().length > 0) {
        return content;
      }
    }
    return null;
  }

  private readTopicProperty(property: NotionTopicProperty | null | undefined): { text: string | null; color: string | null } {
    if (!property) {
      return { text: null, color: null };
    }

    const selectName = property.select?.name ?? null;
    if (selectName && selectName.trim().length > 0) {
      return {
        text: selectName,
        color: property.select?.color ?? null,
      };
    }

    const multi = property.multi_select ?? [];
    if (Array.isArray(multi) && multi.length > 0) {
      const names = multi
        .map((entry) => (typeof entry?.name === 'string' ? entry.name : null))
        .filter((name): name is string => !!name && name.trim().length > 0);
      const firstColor = multi.find((entry) => typeof entry?.color === 'string' && entry.color.trim().length > 0)?.color ?? null;
      if (names.length > 0) {
        return {
          text: names.join(', '),
          color: firstColor,
        };
      }
    }

    const titleText = this.extractPlainText(property.title ?? undefined);
    if (titleText) {
      return { text: titleText, color: null };
    }

    const richText = this.extractPlainText(property.rich_text ?? undefined);
    if (richText) {
      return { text: richText, color: null };
    }

    const plain = property.plain_text;
    if (typeof plain === 'string' && plain.trim().length > 0) {
      return { text: plain, color: null };
    }

    return { text: null, color: null };
  }

  /**
   * Converts a value from a configured Notion unit into seconds.
   * Defaults to seconds for backward compatibility when unit is undefined.
   */
  private toSecondsFromUnit(value: number, unit: 'seconds' | 'minutes' | 'hours' | undefined): number {
    if (unit === 'minutes') return value * 60;
    if (unit === 'hours') return value * 3600;
    return value; // 'seconds' or undefined
  }

  /**
   * Converts a seconds value into the configured Notion unit.
   * Defaults to seconds for backward compatibility when unit is undefined.
   */
  private fromSecondsToUnit(seconds: number, unit: 'seconds' | 'minutes' | 'hours' | undefined): number {
    if (unit === 'minutes') return Math.round((seconds / 60) * 100) / 100;
    if (unit === 'hours') return Math.round((seconds / 3600) * 100) / 100;
    return seconds; // 'seconds' or undefined
  }

  constructor(
    apiToken: string,
    databaseId: string,
    propertyMapping?: NotionPropertyMapping,
    statusMapping?: NotionStatusMapping,
    priorityMapping?: NotionPriorityMapping | LegacyNotionPriorityMapping,
    dataSourceId?: string | null,
  ) {
    this.apiToken = apiToken;
    this.api = new NotionClientAPI(apiToken);
    this.databaseId = databaseId;
    this.dataSourceId = dataSourceId ?? null;
    this.propertyMapping = propertyMapping || {
      title: "Name",
      status: "Status",
    };
    this.statusMapping = statusMapping || {
      today: "Today",
      doing: "Doing",
      done: "Done",
      waiting: "Waiting",
    };
    // A mapping stored before #617 (urgent/high/medium/low) is still read
    this.priorityMapping = normalizePriorityMapping(priorityMapping);
  }

  /**
   * List databases accessible to the integration
   */
  async listDatabases(): Promise<NotionDatabaseSummary[]> {
    try {
      // Search for databases and data sources
      const [dbResponse, dsResponse] = await Promise.all([
        this.api.searchDatabases(),
        this.api.searchDataSources(),
      ]);

      // Check if server proxy already returned pre-processed DatabaseSummary objects
      // (browser mode returns processed data, Tauri mode returns raw Notion API data)
      const firstResult = dbResponse.results[0] as NotionDatabaseSummary | { object?: string; title?: unknown[] } | undefined;
      const isPreProcessed = firstResult && 'dataSources' in firstResult && typeof (firstResult as NotionDatabaseSummary).title === 'string';
      
      if (isPreProcessed) {
        // Server proxy already processed the data - use it directly
        return dbResponse.results as NotionDatabaseSummary[];
      }

      // Raw Notion API response (Tauri mode) - process it ourselves
      // Build a map of database_id -> data sources
      const dataSourcesByDb = new Map<string, Array<{ id: string; name: string | null; databaseId: string; databaseTitle: string }>>();
      
      for (const ds of dsResponse.results as any[]) {
        if (ds?.object !== 'data_source') continue;
        const dsId = ds.id;
        const dsName = ds.name ?? null;
        let databaseId = ds.location?.database_id;
        
        // Try to get database_id from data source details if not in search result
        if (!databaseId && dsId) {
          try {
            const details = await this.api.getDataSource(dsId);
            databaseId = details.location?.database_id || details.parent?.database_id;
          } catch {
            // Ignore errors fetching data source details
          }
        }
        
        if (!databaseId) continue;
        
        const existing = dataSourcesByDb.get(databaseId) || [];
        existing.push({ id: dsId, name: dsName, databaseId, databaseTitle: '' });
        dataSourcesByDb.set(databaseId, existing);
      }

      // Build database summaries
      const summaries: NotionDatabaseSummary[] = [];
      
      for (const db of dbResponse.results as any[]) {
        if (db?.object !== 'database') continue;
        const dbId = db.id;
        const title = db.title?.map((t: any) => t.plain_text).join('') || 'Untitled Database';
        
        const dataSources = (dataSourcesByDb.get(dbId) || []).map(ds => ({
          ...ds,
          databaseTitle: title,
        }));
        
        summaries.push({ id: dbId, title, dataSources });
      }

      // Add databases that only appeared in data source results
      for (const [dbId, dataSources] of dataSourcesByDb) {
        if (!summaries.find(s => s.id === dbId)) {
          try {
            const dbDetails = await this.api.getDatabase(dbId);
            const title = (dbDetails.title as any[])?.map((t: any) => t.plain_text).join('') || 'Untitled Database';
            summaries.push({
              id: dbId,
              title,
              dataSources: dataSources.map(ds => ({ ...ds, databaseTitle: title })),
            });
          } catch {
            // Skip databases we can't access
          }
        }
      }

      return summaries;
    } catch (error) {
      this.handleError(error, 'notion_setup');
      throw error;
    }
  }

  /**
   * Maps TaskStatus to Notion status string using configured status mapping
   */
  private mapStatusToNotion(status: TaskStatus): string {
    const reverseStatusMap: Record<TaskStatus, string> = {
      [TaskStatus.Open]: this.statusMapping.today,
      [TaskStatus.Progress]: this.statusMapping.doing,
      [TaskStatus.Waiting]: this.statusMapping.waiting || "Waiting",
      [TaskStatus.Done]: this.statusMapping.done,
      [TaskStatus.Backlog]: "Backlog", // Backlog is not configurable, use default
    };
    return reverseStatusMap[status] || this.statusMapping.today;
  }

  /**
   * Creates a new task in Notion
   * @param task The task to create
   * @returns The created task with Notion ID
   */
  async createTask(task: Partial<Task>): Promise<Task> {
    // Errors propagate: the caller owns the create feedback (task_create context, #167)
    const statusType = await this.statusPropertyType();
    // Build properties object for Notion
    const properties: Record<string, any> = {
      // Title is required
      [this.propertyMapping.title]: {
        title: [
          {
            text: {
              content: task.title || "Untitled",
            },
          },
        ],
      },
      // Status
      [this.propertyMapping.status]: this.statusValue(
        statusType,
        task.status !== undefined ? this.mapStatusToNotion(task.status) : this.statusMapping.today,
      ),
    };

    // Add optional properties if mapped and provided
    if (this.propertyMapping.priority && task.priority) {
      properties[this.propertyMapping.priority] = {
        select: {
          name: this.getPriorityName(task.priority),
        },
      };
    }

    if (this.propertyMapping.timeBox && task.timeBoxSeconds) {
      // Timebox can be number, select, or rich_text depending on database schema
      const unit = this.propertyMapping.timeBoxUnit ?? 'formatted';
      
      if (unit === 'formatted') {
        // Write as select with minutes (default formatted behavior)
        const minutes = Math.round(task.timeBoxSeconds / 60);
        properties[this.propertyMapping.timeBox] = {
          select: {
            name: `${minutes}`,
          },
        };
      } else {
        // Write as number in the configured unit
        const value = this.fromSecondsToUnit(task.timeBoxSeconds, unit);
        properties[this.propertyMapping.timeBox] = {
          number: value,
        };
      }
    }

    if (this.propertyMapping.topic && task.topic) {
      // The property's own type (kd#16): a select Thema rejected the former rich_text write with a 400. Unknown type: rich_text, the most flexible
      const type = await this.labelPropertyType(this.propertyMapping.topic);
      properties[this.propertyMapping.topic] = this.labelValue(type ?? 'rich_text', task.topic);
    }

    if (this.propertyMapping.activity) {
      // The property's own type (kd#16). Unknown type: multi_select (single value array), compatible with both select kinds on read.
      // An empty value is still sent, so a required field is cleared rather than left out
      const type = await this.labelPropertyType(this.propertyMapping.activity);
      properties[this.propertyMapping.activity] = this.labelValue(type ?? 'multi_select', task.activity);
    }

    if (this.propertyMapping.dueDate && task.notes) {
      // Store notes as rich text if a notes/description field is mapped as dueDate
      // Note: This is a workaround; ideally there should be a separate notes mapping
      properties[this.propertyMapping.dueDate] = {
        rich_text: [
          {
            text: {
              content: task.notes.substring(0, 2000), // Notion limit
            },
          },
        ],
      };
    }

    // Add custom properties if provided
    if (task.custom && this.propertyMapping.customProperties) {
      for (const cfg of this.propertyMapping.customProperties.filter(c => c.enabled)) {
        const customEntry = task.custom[cfg.key];
        if (customEntry) {
          properties[cfg.name] = this.writeCustomProperty(customEntry.value);
        }
      }
    }

    // Add unplanned flag if configured and set
    this.writeUnplannedFlag(properties, task.isUnplanned ?? false);

    const result = await this.api.createPage(this.databaseId, properties);

    if (import.meta.dev) {
      console.log('[NotionIntegration] Successfully created task in Notion:', result.id);
    }

    // Return the task with the Notion ID
    return {
      ...task,
      id: result.id,
      source: 'notion',
      externalId: result.id,
      status: task.status ?? TaskStatus.Open,
      title: task.title || "Untitled",
      notes: task.notes || null,
      priority: normalizePriority(task.priority),
      timeBoxSeconds: task.timeBoxSeconds || null,
      timeSpentSeconds: task.timeSpentSeconds || 0,
      topic: task.topic || null,
      topicColorCode: task.topicColorCode || null,
      activity: task.activity || null,
      timerId: null,
      completedAt: null,
      archivedAt: null,
      isUnplanned: task.isUnplanned || false,
    } as Task;
  }

  /**
   * Writes the unplanned flag to Notion properties based on configured mapping.
   * For multi_select properties, only adds/removes the match value without touching other values.
   * @param properties The properties object to modify
   * @param isUnplanned Whether the task is unplanned
   */
  private writeUnplannedFlag(properties: Record<string, any>, isUnplanned: boolean): void {
    const mapping = this.propertyMapping.unplanned;
    
    // No mapping configured: nothing to write
    if (!mapping) return;

    if (mapping.mode === 'boolean' && mapping.propertyName) {
      // Boolean mode: write checkbox property
      properties[mapping.propertyName] = {
        checkbox: isUnplanned,
      };
    } else if (mapping.mode === 'value' && mapping.valuePropertyName && mapping.matchValue) {
      // Value mode: add/remove the match value from select/multi_select/text
      
      if (isUnplanned) {
        // Write based on property type
        const propType = mapping.propertyType || 'select';
        
        if (propType === 'multi_select') {
          // For multi_select, write as single-value array
          // The server will merge this with existing values if mergeMultiSelectProperties is set
          properties[mapping.valuePropertyName] = {
            multi_select: [{ name: mapping.matchValue }],
          };
        } else if (propType === 'select') {
          // Write as select object
          properties[mapping.valuePropertyName] = {
            select: { name: mapping.matchValue },
          };
        } else if (propType === 'rich_text' || propType === 'title') {
          // Write as text
          properties[mapping.valuePropertyName] = {
            rich_text: [{ text: { content: mapping.matchValue } }],
          };
        }
      }
      // Note: When isUnplanned=false, we don't write anything to avoid clearing other values
      // The read logic (extractUnplannedFlag) handles absence as false
    }
  }

  /**
   * Writes a custom property value to Notion format
   */
  private writeCustomProperty(value: TaskCustomValue): any {
    switch (value.type) {
      case 'text':
        return {
          rich_text: value.value ? [{ text: { content: value.value } }] : [],
        };
      case 'number':
        return {
          number: value.value,
        };
      case 'select':
        return {
          select: value.value ? { name: value.value.name } : null,
        };
      case 'multi_select':
        return {
          multi_select: value.value.map(v => ({ name: v.name })),
        };
      case 'date':
        return {
          date: value.value,
        };
      case 'checkbox':
        return {
          checkbox: value.value,
        };
      case 'url':
        return {
          url: value.value,
        };
      case 'email':
        return {
          email: value.value,
        };
      case 'phone_number':
        return {
          phone_number: value.value,
        };
      default:
        return null;
    }
  }

  /**
   * Updates a task in Notion and returns the synced task with Notion's current state.
   * Implements bidirectional sync: after updating, fetches the page to ensure local state
   * matches Notion (e.g., preserves tags added directly in Notion).
   * @param task The task to update; Notion is addressed by its `externalId` (the page id), never by `id`
   * @param change `timeEdited`: the user set the total time spent (kd#4), so it is written even at 0 (the property
   *   is cleared). An ordinary push at 0 leaves the property alone, so time another device recorded survives.
   * @returns The task with properties synced from Notion after the update
   */
  async updateTask(task: Task, change: { timeEdited?: boolean } = {}): Promise<Task> {
    const externalId = externalIdOf(task);
    try {
      const statusType = await this.statusPropertyType();
      const properties: Record<string, { select?: { name: string }; status?: { name: string }; number?: number | null; date?: { start: string } | null }> = {
        [this.propertyMapping.status]: this.statusValue(
          statusType,
          (task.archivedAt && this.statusMapping.archive)
            ? this.statusMapping.archive
            : this.mapStatusToNotion(task.status),
        ),
      };

      // Add time spent if it exists and is mapped, converting to configured unit
      if (task.timeSpentSeconds && task.timeSpentSeconds > 0 && this.propertyMapping.timeSpent) {
        const unit = this.propertyMapping.timeSpentUnit; // undefined => seconds (back-compat)
        const valueToWrite = this.fromSecondsToUnit(task.timeSpentSeconds, unit);
        properties[this.propertyMapping.timeSpent] = {
          number: valueToWrite,
        };
      }
      else if (change.timeEdited && this.propertyMapping.timeSpent) {
        // The user cleared the total (kd#4): an empty number, not a skipped property
        properties[this.propertyMapping.timeSpent] = { number: null };
      }

      // Add timeBox if it exists and is mapped, converting based on configured unit
      if (task.timeBoxSeconds && task.timeBoxSeconds > 0 && this.propertyMapping.timeBox) {
        const unit = this.propertyMapping.timeBoxUnit ?? 'formatted';
        
        if (unit === 'formatted') {
          // Write as select with minutes (default formatted behavior)
          const minutes = Math.round(task.timeBoxSeconds / 60);
          properties[this.propertyMapping.timeBox] = {
            select: {
              name: `${minutes}`,
            },
          };
        } else {
          // Write as number in the configured unit
          const value = this.fromSecondsToUnit(task.timeBoxSeconds, unit);
          properties[this.propertyMapping.timeBox] = {
            number: value,
          };
        }
      }

      // Add completion date if property is mapped
      if (this.propertyMapping.completedDate) {
        if (task.completedAt) {
          // Set the completion date
          properties[this.propertyMapping.completedDate] = {
            date: { start: task.completedAt.toISOString() },
          };
        } else {
          // Clear the completion date if task is no longer done
          properties[this.propertyMapping.completedDate] = {
            date: null,
          };
        }
      }

      // Add custom properties if provided
      if (task.custom && this.propertyMapping.customProperties) {
        for (const cfg of this.propertyMapping.customProperties.filter(c => c.enabled)) {
          const customEntry = task.custom[cfg.key];
          if (customEntry) {
            properties[cfg.name] = this.writeCustomProperty(customEntry.value);
          }
        }
      }

      // Add unplanned flag if configured
      this.writeUnplannedFlag(properties, task.isUnplanned ?? false);

      // Priority (#678): written only when the level Notion holds differs from the local one, so an option the
      // mapping does not list (or another option of the same level, or an empty select) is never rewritten by an
      // unrelated update. The current page is read once below, shared with the multi_select merge.
      const priorityProperty = this.propertyMapping.priority;
      const priorityName = priorityProperty ? this.getPriorityName(task.priority) : '';
      const needsPriorityCheck = Boolean(priorityProperty && priorityName);
      // Thema and Aktivität (kd#39): written only when the value Notion holds differs from the local one, so an
      // unrelated push never rewrites them (a multi_select with several values reads back as "A, B", which must
      // not become one new option). The page read is the same one as above.
      const labelProperties = [this.propertyMapping.topic, this.propertyMapping.activity].filter((name): name is string => Boolean(name));

      // Determine which properties need merging (multi_select properties that might have external values)
      const mergeMultiSelectProperties: string[] = [];
      
      // If unplanned mapping uses a multi_select property, we need to merge it
      if (this.propertyMapping.unplanned?.mode === 'value' && 
          this.propertyMapping.unplanned.valuePropertyName &&
          this.propertyMapping.unplanned.propertyType === 'multi_select') {
        mergeMultiSelectProperties.push(this.propertyMapping.unplanned.valuePropertyName);
      }

      // Handle multi_select merge if needed
      const finalProperties = properties as Record<string, unknown>;
      if (mergeMultiSelectProperties.length > 0 || needsPriorityCheck || labelProperties.length > 0) {
        // Fetch current page to merge multi_select values and to compare the priority and the labels
        const currentPage = await this.api.getPage(externalId);
        if (this.propertyMapping.topic) {
          await this.writeChangedLabel(finalProperties, currentPage.properties, this.propertyMapping.topic, task.topic, 'rich_text');
        }
        if (this.propertyMapping.activity) {
          await this.writeChangedLabel(finalProperties, currentPage.properties, this.propertyMapping.activity, task.activity, 'multi_select');
        }
        if (needsPriorityCheck && priorityProperty) {
          const heldSelect = currentPage.properties?.[priorityProperty] as { select?: { name?: string | null } | null } | undefined;
          if (notionNameToPriority(heldSelect?.select?.name, this.priorityMapping) !== normalizePriority(task.priority)) {
            finalProperties[priorityProperty] = { select: { name: priorityName } };
          }
        }
        for (const propName of mergeMultiSelectProperties) {
          const newValue = properties[propName] as { multi_select?: Array<{ name: string }> } | undefined;
          const currentValue = currentPage.properties[propName] as { type?: string; multi_select?: Array<{ name: string }> } | undefined;
          
          if (newValue?.multi_select && currentValue?.type === 'multi_select' && currentValue.multi_select) {
            const allOptions = [...currentValue.multi_select];
            for (const newOpt of newValue.multi_select) {
              if (!allOptions.some(existing => existing.name === newOpt.name)) {
                allOptions.push(newOpt);
              }
            }
            finalProperties[propName] = { multi_select: allOptions };
          }
        }
      }

      await this.api.updatePage(externalId, finalProperties);
      
      // Fetch the updated page from Notion to sync local state (bidirectional sync)
      const updatedPage = await this.api.getPage(externalId) as unknown as NotionPage;
      
      // Parse the updated page to get Notion's current state
      const syncedTask = this.parseNotionPageToTask(updatedPage);
      
      // Preserve local-only properties that aren't synced to Notion
      syncedTask.timerId = task.timerId; // Active timer state is local-only
      
      if (import.meta.dev) {
        console.log('[NotionIntegration] Successfully updated and synced task from Notion:', externalId);
        console.log('[NotionIntegration] Synced properties:', {
          isUnplanned: syncedTask.isUnplanned,
          status: syncedTask.status,
          timeSpentSeconds: syncedTask.timeSpentSeconds
        });
      }
      
      return syncedTask;
    } catch (error) {
      this.handleError(error, 'task_operation');
      throw error;
    }
  }

  private getPriorityName(priority: number): string {
    return priorityToNotionName(priority, this.priorityMapping);
  }

  private mapPriorityFromSelect(name?: string): number {
    return notionNameToPriority(name, this.priorityMapping);
  }

  /**
   * Verifies that the configured database is accessible
   * This sanity check helps distinguish between empty results and connection errors
   * @throws Error if database is not accessible
   */
  private async verifyDatabaseAccess(): Promise<void> {
    try {
      // Attempt to retrieve database metadata to verify it exists and is accessible
      const database = await this.api.getDatabase(this.databaseId);
      
      if (!database || !database.id) {
        throw new Error('Database not found or not accessible');
      }

      if (import.meta.dev) {
        console.log('[NotionIntegration] Database access verified:', database.id);
      }
    } catch (error) {
      if (import.meta.dev) {
        console.error('[NotionIntegration] Database access verification failed:', error);
      }
      throw new Error(`Cannot access Notion database: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  /**
   * Retrieves all active tasks for the board based on their status.
   * Returns tasks with status: Today, Doing, Done, Waiting
   * 
   * Note: This includes ALL tasks with these statuses, regardless of date.
   * Done tasks from previous days remain visible until archived.
   * "All" means every page of the query: `queryDataSource` follows Notion's cursor, and a
   * failure on any page lands in the catch below and returns [] instead of a partial list.
   * 
   * @returns Array of tasks that should be displayed on the active board
   */
  async getActiveBoardTasks(): Promise<Array<Task>> {
    try {
      return await this.fetchActiveBoardTasks();
    } catch (error) {
      this.handleError(error, 'task_sync');
      return [];
    }
  }

  /**
   * Same as `getActiveBoardTasks`, but a failure rejects instead of being reported and turned into an
   * empty list, so a caller that syncs several sources (the task source adapter, #318) can tell a failed
   * fetch from an empty one and mark the source's health without a toast or a setup dialog.
   * @throws On a missing database or data source, and on any failure of the access check or a query page
   */
  async fetchActiveBoardTasks(): Promise<Array<Task>> {
    if (!this.databaseId) {
      throw new Error('No database ID configured');
    }

    if (!this.dataSourceId) {
      throw new Error('No data source ID configured');
    }

    // Perform sanity check: verify database exists and is accessible
    await this.verifyDatabaseAccess();

    // Build filter for active statuses (select or native Status, #312)
    const statusType = await this.statusPropertyType();
    const statusFilters = [
      this.statusFilter(statusType, this.statusMapping.today),
      this.statusFilter(statusType, this.statusMapping.doing),
      this.statusFilter(statusType, this.statusMapping.done),
    ];

    if (this.statusMapping.waiting) {
      statusFilters.push(this.statusFilter(statusType, this.statusMapping.waiting));
    }

    const response = await this.api.queryDataSource(this.dataSourceId, {
      filter: { or: statusFilters },
    });

    return (response.results as NotionPage[]).map((page) => this.parseNotionPageToTask(page));
  }

  /**
   * Parses a Notion page into a Task object.
   * Centralizes all property extraction logic for consistency across fetch and update operations.
   * @param page The Notion page to parse
   * @returns Parsed Task object
   */
  private parseNotionPageToTask(page: NotionPage): Task {
    const properties = page.properties ?? ({} as NotionPage['properties']);

    // Extract status first for use in other property calculations
    const statusPropName = this.propertyMapping.status;
    const status = this.mapNotionStatus(
      properties[statusPropName]?.select?.name || properties[statusPropName]?.status?.name || this.statusMapping.today,
    );

    const task: Task = {
      id: page.id,
      source: 'notion',
      externalId: page.id,
      title:
        properties[this.propertyMapping.title]?.title?.[0]?.plain_text ||
        "Untitled",
      notes: "", // Notes are not mapped in this version
      status,
      priority: (() => {
        if (!this.propertyMapping.priority) return DEFAULT_PRIORITY;
        const name = properties[this.propertyMapping.priority]?.select?.name?.toLowerCase();
        return this.mapPriorityFromSelect(name);
      })(),
      timeBoxSeconds: this.propertyMapping.timeBox
        ? this.parseTimeBoxValue(
            properties[this.propertyMapping.timeBox] as unknown as NotionTimeProperty,
            this.propertyMapping.timeBoxUnit
          )
        : null,
      timeSpentSeconds: (() => {
        if (!this.propertyMapping.timeSpent) return 0;
        const prop = properties[this.propertyMapping.timeSpent] as unknown as NotionTimeProperty | undefined;
        // Prefer numeric number property; convert from configured unit to seconds
        const num = (prop as any)?.number as number | undefined;
        if (typeof num === 'number') {
          const unit = this.propertyMapping.timeSpentUnit; // undefined => seconds (back-compat)
          return this.toSecondsFromUnit(num, unit);
        }
        // Fallback: attempt to parse from select/rich_text/title
        const parsed = this.parseTimeValue(prop);
        return parsed ?? 0;
      })(),
      topic: (() => {
        if (!this.propertyMapping.topic) return null;
        const topicProp = properties[this.propertyMapping.topic] as NotionTopicProperty | undefined;
        return this.readTopicProperty(topicProp).text;
      })(),
      topicColorCode: (() => {
        if (!this.propertyMapping.topic) return null;
        const topicProp = properties[this.propertyMapping.topic] as NotionTopicProperty | undefined;
        return this.readTopicProperty(topicProp).color;
      })(),
      activity: (() => {
        if (!this.propertyMapping.activity) return null;
        const activityProp = properties[this.propertyMapping.activity] as NotionTopicProperty | undefined;
        return this.readTopicProperty(activityProp).text;
      })(),
      timerId: null,
      completedAt: (() => {
        // Extract completion date if property is mapped
        if (!this.propertyMapping.completedDate) {
          // No property mapped: default to now if task is done, null otherwise
          return status === TaskStatus.Done ? new Date() : null;
        }
        const completedProp = properties[this.propertyMapping.completedDate];
        if (completedProp?.date?.start) {
          return new Date(completedProp.date.start);
        }
        // Fallback: if task is Done but no date, use current time
        return status === TaskStatus.Done ? new Date() : null;
      })(),
      createdAt: page.created_time ? new Date(page.created_time) : null,
      updatedAt: page.last_edited_time ? new Date(page.last_edited_time) : null,
      archivedAt: null, // Never set from integration
      isUnplanned: this.extractUnplannedFlag(page),
      custom: {},
    } as Task;

    // Parse enabled custom properties
    const customs = this.propertyMapping.customProperties?.filter(c => c.enabled) || [];
    for (const cfg of customs) {
      const entry = this.readCustomProperty(cfg.name, cfg.type, page);
      if (entry) {
        task.custom![cfg.key] = {
          key: cfg.key,
          name: cfg.label || cfg.name,
          propType: cfg.type,
          value: entry,
        } as TaskCustomEntry;
      }
    }

    return task;
  }

  /**
   * Extracts the unplanned flag from a Notion page based on configured mapping.
   * Supports two modes:
   * - 'boolean': Direct checkbox property
   * - 'value': Match a specific value in select/multi_select/text property (case-insensitive)
   * @param page The Notion page to extract from
   * @returns true if task is unplanned, false otherwise
   */
  private extractUnplannedFlag(page: NotionPage): boolean {
    const mapping = this.propertyMapping.unplanned;
    
    // No mapping configured: default to planned (false)
    if (!mapping) return false;

    if (mapping.mode === 'boolean' && mapping.propertyName) {
      // Boolean mode: read checkbox property
      const prop = page.properties[mapping.propertyName];
      return prop?.checkbox === true;
    }

    if (mapping.mode === 'value' && mapping.valuePropertyName && mapping.matchValue) {
      // Value mode: check if property contains the match value (case-insensitive)
      const prop = page.properties[mapping.valuePropertyName] as any;
      if (!prop) return false;

      const matchValueLower = mapping.matchValue.toLowerCase();

      // Handle select property
      if (prop.select?.name) {
        return prop.select.name.toLowerCase() === matchValueLower;
      }

      // Handle multi_select property
      if (Array.isArray(prop.multi_select)) {
        return prop.multi_select.some((option: any) => 
          option?.name?.toLowerCase() === matchValueLower
        );
      }

      // Handle text/rich_text property
      const textValue = prop.rich_text?.[0]?.plain_text || 
                       prop.rich_text?.[0]?.text?.content ||
                       prop.title?.[0]?.plain_text;
      if (textValue) {
        return textValue.toLowerCase().includes(matchValueLower);
      }
    }

    return false;
  }

  /**
   * Reads a Notion property by name and normalizes it into a TaskCustomValue based on type.
   */
  private readCustomProperty(name: string, type: CustomPropertyType, page: NotionPage): TaskCustomValue | null {
    const prop = page.properties?.[name] as any;
    if (!prop) return null;

    const textFrom = (p: any): string | null =>
      p?.rich_text?.[0]?.plain_text || p?.rich_text?.[0]?.text?.content || p?.title?.[0]?.plain_text || null;

    switch (type) {
      case 'text':
        return { type: 'text', value: textFrom(prop) };
      case 'number':
        return { type: 'number', value: typeof prop.number === 'number' ? prop.number : null };
      case 'select': {
        const sel = prop.select ? { name: prop.select.name ?? '', color: prop.select.color } : null;
        return { type: 'select', value: sel };
      }
      case 'multi_select': {
        const arr = Array.isArray(prop.multi_select) ? prop.multi_select.map((o: any) => ({ name: o.name ?? '', color: o.color })) : [];
        return { type: 'multi_select', value: arr };
      }
      case 'date': {
        const d = prop.date ? { start: prop.date.start ?? '', end: (prop.date as any).end } : null;
        return { type: 'date', value: d };
      }
      case 'checkbox':
        return { type: 'checkbox', value: !!prop.checkbox };
      case 'url':
        return { type: 'url', value: typeof prop.url === 'string' ? prop.url : null };
      case 'email':
        return { type: 'email', value: typeof prop.email === 'string' ? prop.email : null };
      case 'phone_number':
        return { type: 'phone_number', value: typeof prop.phone_number === 'string' ? prop.phone_number : null };
      default:
        return null;
    }
  }

  /**
   * Update task status in Notion
   * @param externalId Notion page id (the task's `externalId`)
   * @param status New status
   */
  async updateTaskStatus(externalId: string, status: string): Promise<void> {
    try {
      const statusType = await this.statusPropertyType();
      await this.api.updatePage(externalId, {
        [this.propertyMapping.status]: this.statusValue(statusType, status),
      });
    } catch (error) {
      this.handleError(error, 'task_operation');
    }
  }

  /**
   * Archives the task's page (Notion trash, restorable there). Throws on failure so the
   * caller can queue (offline) or restore the task (#99).
   * @param externalId Notion page id (the task's `externalId`)
   */
  async archiveTask(externalId: string): Promise<void> {
    await this.api.archivePage(externalId);
  }

  /**
   * Takes the task's page out of Notion's trash again (#422). Throws on failure; a page Notion no longer has
   * rejects with status 404, which the caller answers with a new page.
   * @param externalId Notion page id (the task's `externalId`)
   */
  async unarchiveTask(externalId: string): Promise<void> {
    await this.api.unarchivePage(externalId);
  }

  /**
   * List pages that the integration has access to
   * @returns Array of page objects with id and title
   */
  async listPages(): Promise<Array<{ id: string; title: string }>> {
    try {
      const response = await this.api.searchPages();
      return (response.results as any[]).map((page) => ({
        id: page.id,
        title: page.properties?.title?.[0]?.plain_text || 
               page.properties?.Name?.title?.[0]?.plain_text || 
               'Untitled Page',
      }));
    } catch (error) {
      this.handleError(error, 'notion_setup');
      return [];
    }
  }

  /**
   * List databases within a specific parent page
   * @param parentId ID of the parent page
   * @returns Array of database objects with id and title
   */
  async listDatabasesInPage(
    _parentId: string,
  ): Promise<NotionDatabaseSummary[]> {
    try {
      // Get all databases and filter by parent
      const allDatabases = await this.listDatabases();
      // Note: Notion API doesn't directly support filtering by parent in search
      // This returns all databases; filtering by parent would require additional API calls
      // For now, return all databases (the caller can filter if needed)
      return allDatabases;
    } catch (error) {
      this.handleError(error, 'notion_setup');
      return [];
    }
  }

  /**
   * Retrieves archived tasks from Notion for statistics backfill.
   * Only returns tasks if archive status mapping is configured.
   * @returns Array of archived tasks or empty array if no archive mapping
   */
  async getArchivedTasks(): Promise<Array<Task>> {
    if (!this.databaseId) {
      this.handleError(new Error('No database ID configured'), 'task_sync');
      return [];
    }

    if (!this.dataSourceId) {
      this.handleError(new Error('No data source ID configured'), 'task_sync');
      return [];
    }

    // Check if archive status mapping is configured
    if (!this.statusMapping.archive) {
      if (import.meta.dev) {
        console.log('[NotionIntegration] Archive status mapping not configured, skipping archived tasks fetch');
      }
      return [];
    }

    try {
      // Perform sanity check: verify database exists and is accessible
      await this.verifyDatabaseAccess();

      // Query for archived tasks
      const statusType = await this.statusPropertyType();
      const response = await this.api.queryDataSource(this.dataSourceId!, {
        filter: this.statusFilter(statusType, this.statusMapping.archive),
      });

      if (import.meta.dev) {
        console.log(`[NotionIntegration] Successfully fetched ${response.results.length} archived tasks from Notion`);
      }

      return (response.results as NotionPage[]).map((page) => this.parseNotionPageToTask(page));
    } catch (error) {
      this.handleError(error, 'task_sync');
      return [];
    }
  }

  /**
   * Retrieves the property schema from Notion
   * Used to get available options for select/multi-select properties
   *
   * Reads the configured data source's schema when `dataSourceId` is set and the
   * schema is requested for the configured database (a database with several data
   * sources has one schema per source). Falls back to the database when the data
   * source read fails or has no properties.
   * @param options `report: false` rethrows without reporting: a background read (the property options of the
   *   tasks page) leaves the failure to its caller, who records it as the source's health (#341)
   * @returns The property schema
   */
  async getDatabaseSchema(databaseId?: string, options: { report?: boolean } = {}): Promise<NotionDatabaseSchema> {
    const dbId = databaseId || this.databaseId;
    if (!dbId) {
      throw new Error('No database ID provided');
    }

    try {
      if (this.dataSourceId && dbId === this.databaseId) {
        try {
          const dataSource = await this.api.getDataSource(this.dataSourceId);
          if (dataSource.properties && Object.keys(dataSource.properties).length > 0) {
            return dataSource.properties;
          }
        } catch {
          // Fall back to the database schema
        }
      }
      const database = await this.api.getDatabase(dbId);
      return database.properties as NotionDatabaseSchema;
    } catch (error) {
      if (options.report !== false) this.handleError(error, 'notion_setup');
      throw error;
    }
  }

  /**
   * Standardized error handling for Notion integration.
   * Safely handles errors even when called outside Vue component context.
   */
  private handleError(error: unknown, errContext: 'notion_setup' | 'task_sync' | 'task_operation'): void {
    // Always log to console for debugging
    console.error(`[NotionIntegration] ${errContext}:`, error);
    
    // Try to use the error handler composable if in Vue context
    // This may fail if called outside component setup, so we catch and ignore
    try {
      const { handleError } = useErrorHandler();
      handleError(error as Error, errContext, { source: 'notion' });
    } catch {
      // Not in Vue context - error already logged above
    }
  }
}
