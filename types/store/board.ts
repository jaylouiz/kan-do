import type { Task } from "@/types/task";
import type { TaskSourcesConfig } from "@/types/taskSource";

export interface BoardColumn {
  id: string;
  title: string;
  taskIds: string[];
}

export interface BoardConfig {
  sources: TaskSourcesConfig | null;
  columns: BoardColumn[];
  showCompletedTasks: boolean;
  autoRefreshInterval?: number;
}

export interface BoardState {
  boardConfig: BoardConfig;
  columns: BoardColumn[];
}

export interface BoardGetters {
  columnById: (id: string) => BoardColumn | undefined;
  tasksInColumn: (columnId: string) => Task[];
  isValidColumn: (columnId: string) => boolean;
}

export interface BoardActions {
  setBoardConfig: (config: Partial<BoardConfig>) => void;
  addColumn: (column: BoardColumn) => void;
  removeColumn: (columnId: string) => void;
  updateColumn: (columnId: string, updates: Partial<BoardColumn>) => void;
  moveTaskBetweenColumns: (taskId: string, fromColumnId: string, toColumnId: string) => void;
  reorderTasksInColumn: (columnId: string, taskIds: string[]) => void;
}
