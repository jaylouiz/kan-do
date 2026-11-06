import type { Task } from "./task";
import type { TaskStatus } from "~/types/taskStatus";
import type { TaskSourcesConfig } from "~/types/taskSource";

export type SortField = 'manual' | 'dateCreated' | 'dateCompleted' | 'dateUpdated' | 'priority' | 'timeBox';
export type SortDirection = 'asc' | 'desc';

export interface ColumnSorting {
  field: SortField;
  direction: SortDirection;
}

export interface IColumn {
  idClassSuffix: string;
  taskStatus: TaskStatus;
  taskOrder: Array<string>; // Kept for backward compatibility
  taskPositions?: Record<string, number>; // Changed from Map<string, number>
  sorting?: ColumnSorting;
}

export interface IBoardConfig {
  /** Connected integrations and the default source; `null` = never onboarded. Local is implicit. */
  sources: TaskSourcesConfig | null;
  /**
   * One-shot marker: the board switched to an integration and its tasks have not arrived yet. The first
   * non-empty fetch replaces the other sources' tasks and removes the marker. Absent = no switch pending.
   */
  pendingSourceSwitch?: boolean;
  integrationData?: {
    notionDatabaseId?: string;
  };
  notionDatabaseId?: string;
  todoistApiToken?: string;
}

export default interface IState {
  isInitialized: boolean;
  boardConfig: IBoardConfig;
  tasks: Array<Task>;
  columns: Array<IColumn>;
  isLoading: boolean;
  lastSyncTimestamp: number | null;
  pendingTimeUpdates: Record<string, number>; // Maps taskId to timeSpentSeconds
}
