/**
 * Interface representing a due date in Todoist
 */
interface ITodoistDue {
  date: string;
  isRecurring: boolean;
  string: string;
  datetime?: string;
  timezone?: string;
}

/**
 * Interface representing a Todoist task
 */
interface ITodoistTask {
  assignee: number | null;
  assigner: number | null;
  commentCount: number | null;
  content: string | null;
  createdAt?: string | null;
  creatorId?: string | null;
  description: string | null;
  due: ITodoistDue | null;
  id: string;
  isCompleted: boolean | null;
  labels: string[] | null;
  order?: number | null;
  parentId: string | null;
  priority: number | null;
  projectId: string | null;
  sectionId: string | null;
  url: string | null;
}
export type { ITodoistTask };
