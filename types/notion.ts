/**
 * Represents the different property types available in Notion
 */
export type NotionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export interface NotionOption {
  id: string;
  name: string;
  color: NotionColor | string;
  description?: string | null;
}

export interface NotionPropertyType {
  id: string;
  name: string;
  type: string;
  select?: { options: Array<NotionOption> };
  status?: { options: Array<NotionOption> };
  multi_select?: { options: Array<NotionOption> };
  // Add other property types as needed
  title?: unknown;
  rich_text?: unknown;
  number?: unknown;
  date?: unknown;
  checkbox?: unknown;
  url?: unknown;
  email?: unknown;
  phone_number?: unknown;
}

/**
 * Represents the schema of a Notion database
 */
export interface NotionDatabaseSchema {
  [key: string]: NotionPropertyType;
}

/**
 * Supported custom property types we normalize from Notion schema types.
 */
export type CustomPropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number';

/**
 * Configuration for mapping the unplanned flag from Notion properties.
 * Supports two modes:
 * - 'boolean': Direct mapping to a checkbox property
 * - 'value': Match a specific value in a select/multi_select/text property
 */
export interface UnplannedMapping {
  /** Mapping mode: direct boolean or value-based matching */
  mode: 'boolean' | 'value';
  /** For boolean mode: name of the checkbox property */
  propertyName?: string;
  /** For value mode: name of the property to check */
  valuePropertyName?: string;
  /** For value mode: value to match (case-insensitive) */
  matchValue?: string;
  /** For value mode: property type (select vs multi_select) for correct write format */
  propertyType?: 'select' | 'multi_select' | 'rich_text' | 'title';
}

/**
 * Configuration for a single custom property selected by the user.
 */
export interface NotionCustomPropertyConfig {
  /** Original property name in Notion */
  name: string;
  /** Normalized type */
  type: CustomPropertyType;
  /** Whether this property should be synced */
  enabled: boolean;
  /** Optional display label override */
  label?: string;
  /** Stable key (slug) used as dictionary key on Task.custom */
  key: string;
}

/**
 * Mapping between kan-do task properties and Notion properties
 */
export interface NotionPropertyMapping {
  timeSpent?: string | null;
  /**
   * Unit of the mapped Notion number field for time spent.
   * Optional for backward compatibility: when omitted, treat as 'seconds'.
   */
  timeSpentUnit?: 'seconds' | 'minutes' | 'hours';
  title: string;
  status: string;
  dueDate?: string | null;
  priority?: string | null;
  timeBox?: string | null;
  /**
   * Unit of the mapped Notion field for time box.
   * - 'seconds': Notion field contains raw seconds
   * - 'minutes': Notion field contains raw minutes
   * - 'hours': Notion field contains raw hours
   * - 'formatted': Notion field contains formatted strings like "15 min", "2h", etc.
   * Optional for backward compatibility: when omitted, treat as 'formatted'.
   */
  timeBoxUnit?: 'seconds' | 'minutes' | 'hours' | 'formatted';
  topic?: string | null;
  activity?: string | null;
  /**
   * Notion date property for task completion timestamp.
   * Optional; used to track when tasks were marked done.
   */
  completedDate?: string | null;
  /**
   * User-selected additional properties to import from Notion.
   * Optional; defaults to empty array for backward compatibility.
   */
  customProperties?: NotionCustomPropertyConfig[];
  /**
   * Configuration for mapping the unplanned flag.
   * Optional; when not configured, all tasks default to planned.
   */
  unplanned?: UnplannedMapping | null;
}

/**
 * Mapping between kan-do status values and Notion select option names
 */
export interface NotionStatusMapping {
  today: string;
  doing: string;
  done: string;
  waiting?: string | null;
  /** Optional Notion status to apply when tasks are archived locally */
  archive?: string | null;
}

/**
 * Mapping between kan-do's three priority levels and Notion select option names (#617).
 * Several options may share a level; kan-do writes the first option of a level back.
 */
export interface NotionPriorityMapping {
  /** Options read as High (3) - at least one is required */
  high: string[];
  /** Options read as Regular (2) */
  regular: string[];
  /** Options read as Low (1) */
  low: string[];
}

/**
 * The four-level shape stored before #617. Still read (`normalizePriorityMapping`), replaced by
 * `NotionPriorityMapping` when the user saves the priority mapping.
 */
export interface LegacyNotionPriorityMapping {
  urgent: string;
  high: string;
  medium?: string | null;
  low?: string | null;
}

/**
 * Lightweight representation of a Notion data source entry returned by the API.
 */
export interface NotionDataSourceSummary {
  id: string;
  /** Human friendly data source name. */
  name: string | null;
  /** Identifier of the parent database that owns this data source. */
  databaseId: string;
  /** Title of the parent database if available. */
  databaseTitle: string | null;
}

export interface NotionDatabaseSummary {
  id: string;
  title: string;
  dataSources: NotionDataSourceSummary[];
}

/**
 * Configuration for Notion integration
 */
export interface NotionConfig {
  token: string;
  databaseId: string;
  /** Optional cached name for display in settings */
  databaseName?: string | null;
  /** Specific data source inside the database to operate on. */
  dataSourceId: string | null;
  /** Optional cached name for display in setup flows. */
  dataSourceName?: string | null;
  propertyMapping: NotionPropertyMapping;
  statusMapping: NotionStatusMapping;
  /** Optional priority mapping configuration; a stored legacy shape is read through `normalizePriorityMapping` (#617) */
  priorityMapping?: NotionPriorityMapping | LegacyNotionPriorityMapping;
}
