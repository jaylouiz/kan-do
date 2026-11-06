import type { Task } from "@/types/task";
import type { TaskStatus } from "~/types/taskStatus";
import type { PendingTimeUpdate } from "@/types/pendingTimeUpdate";
import type { CustomPropertyIndex } from "@/types/customPropertyIndex";
import type { IntegrationSourceId, SourceId } from "~/types/taskSource";

export interface TasksState {
  tasks: Task[];
  isLoading: boolean;
  lastSyncTimestamp: Date | null;
  pendingTimeUpdates: Map<string, PendingTimeUpdate>;
  archivedTaskIds: string[];
  customPropertyIndexes: Map<string, CustomPropertyIndex>;
}

export interface TasksGetters {
  task: (id: string) => Task | null;
  tasksByStatus: (status: TaskStatus) => Task[];
  openTasks: Task[];
  doneTasks: Task[];
  hasPendingTimeUpdates: boolean;
}

export interface TasksActions {
  setTasks: (tasks: Task[]) => void;
  mergeTasks: (source: SourceId, fetchedTasks: Task[], options?: { replaceOthers?: boolean }) => void;
  adoptAsLocal: (keep?: SourceId | null) => void;
  beginSourceSwitch: (source: IntegrationSourceId) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  removeTask: (taskId: string) => void;
  setLoading: (loading: boolean) => void;
  setLastSyncTimestamp: (timestamp: Date) => void;
  addPendingTimeUpdate: (taskId: string, timeSpent: number) => void;
  clearPendingTimeUpdate: (taskId: string) => void;
  clearAllPendingTimeUpdates: () => void;
}

export interface TaskFilterOptions {
  status?: TaskStatus;
  source?: string;
  topic?: string;
  hasTimeBox?: boolean;
  search?: string;
}

export interface TaskSortOptions {
  field: 'title' | 'priority' | 'timeBoxSeconds' | 'timeSpentSeconds';
  direction: 'asc' | 'desc';
}
