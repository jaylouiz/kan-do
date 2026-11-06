import { TodoistApi } from "@doist/todoist-api-typescript";
import type { CustomFetch } from "@doist/todoist-api-typescript";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "~/types/task";
import type { ITodoistTask } from "~/types/todoistTask";
import type { ITodoistLabel } from "~/types/todoistLabel";
import type { ITodoistProject } from "~/types/todoistProject";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { priorityToTodoist, todoistToPriority } from '~/lib/priority';

/** Same limit as `NotionClientAPI`'s `DEFAULT_TIMEOUT_MS`. */
export const TODOIST_TIMEOUT_MS = 10000;

const COMPLETED_PAGE_SIZE = 200;
const COMPLETED_PAGE_CAP = 10;

type SdkTask = Awaited<ReturnType<TodoistApi['getTask']>>;

const TIMEOUT_MESSAGE_PREFIX = 'Todoist request timeout after';

/**
 * Thrown when a Todoist request exceeds its timeout and was aborted.
 *
 * Deliberately not named `TimeoutError`: the SDK retries those (3x) and a hung write must fail fast.
 * The message contains "timeout" so `isNetworkError` (offline path, delete queueing) recognises it.
 */
export class TodoistTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`${TIMEOUT_MESSAGE_PREFIX} ${timeoutMs}ms`);
    this.name = 'TodoistTimeoutError';
  }
}

/**
 * Whether `error` is our request timeout. The SDK rewraps every failure as `TodoistRequestError(error.message)`,
 * which drops the class and name, so the message is the only thing that survives.
 */
export const isTodoistTimeoutError = (error: unknown): boolean =>
  error instanceof TodoistTimeoutError ||
  (error instanceof Error && error.message.startsWith(TIMEOUT_MESSAGE_PREFIX));

/**
 * Builds the `customFetch` handed to `TodoistApi`: every request (headers and body) is aborted via a
 * real `AbortController` after `timeoutMs`, so a request that never settles cannot block the per-task
 * status-write chain in `useTaskSync` (#159). The SDK passes its own 30s timeout and signal; the
 * shorter of the two wins and the SDK signal is forwarded. The body is read inside the timeout.
 *
 * @param timeoutMs Upper bound for one request
 * @param fetchImpl Underlying fetch, resolved lazily from the global when omitted
 */
export function createTimeoutFetch(timeoutMs: number = TODOIST_TIMEOUT_MS, fetchImpl?: typeof fetch): CustomFetch {
  return async (url, options) => {
    const { timeout, signal: callerSignal, ...init } = options ?? {};
    const effectiveMs = timeout !== undefined && timeout > 0 ? Math.min(timeout, timeoutMs) : timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TodoistTimeoutError(effectiveMs)), effectiveMs);
    const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardCallerAbort();
    else callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });

    try {
      const response = await (fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
      };
    } catch (error) {
      // Engines that reject an aborted fetch with a generic AbortError (older WebKit) lose our reason
      if (controller.signal.reason instanceof TodoistTimeoutError) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardCallerAbort);
    }
  };
}

export class TodoistIntegration {
  private apiToken: string;
  private todoistApi: TodoistApi;
  private timeoutFetch: CustomFetch = createTimeoutFetch();
  private todoistLabels: Array<ITodoistLabel> = [];
  private todoistProjects: Array<ITodoistProject> = [];

  constructor(apiToken: string) {
    this.apiToken = apiToken;
    this.todoistApi = new TodoistApi(apiToken, { customFetch: this.timeoutFetch });
  }

  /**
   * Retrieves all active tasks for the board.
   * For Todoist: Returns tasks scheduled for today (open) and completed today.
   * 
   * Note: Unlike Notion, Todoist naturally filters by date ('today' filter).
   * Completed tasks from previous days are not included.
   * 
   * @returns Array of tasks that should be displayed on the active board
   */
  async getActiveBoardTasks(): Promise<Array<Task>> {
    if (!this.apiToken) {
      const { handleError } = useErrorHandler();
      handleError('No Todoist API token configured', 'task_sync');
      return [];
    }

    try {
      return await this.fetchActiveBoardTasks();
    } catch (error) {
      this.handleError(error, 'Error in getActiveBoardTasks');
      return [];
    }
  }

  /**
   * Same as `getActiveBoardTasks`, but a failure rejects instead of being reported and turned into an
   * empty list, so a caller that syncs several sources (the task source adapter, #318) can tell a failed
   * fetch from an empty one and mark the source's health without a toast. The labels, projects and active
   * tasks requests decide the fetch: any of them failing rejects it. The tasks completed today are optional
   * enrichment (`getCompletedBoardTasks`) and never fail the fetch.
   * @throws On a missing token and when the labels, projects or active tasks request fails
   */
  async fetchActiveBoardTasks(): Promise<Array<Task>> {
    if (!this.apiToken) {
      throw new Error('No Todoist API token configured');
    }

    this.todoistLabels = await this.getTodoistLabels();
    this.todoistProjects = await this.getTodoistProjects();

    // Step 1: Get Completed Tasks (from today), best effort
    const completedTasks = await this.getCompletedBoardTasks();

    // Step 2: Get Active Tasks (scheduled for today), decides the fetch
    const activeTasks = this.mapTodoistTaskArrayToTaskArray(
      await this.getOpenTodayTodoistTasks(),
    );

    return [...completedTasks, ...activeTasks];
  }

  /**
   * The tasks completed today. Optional enrichment, as before #318: a failing completed-tasks request
   * (#343) is skipped, so the active tasks still arrive and the source stays healthy.
   */
  private async getCompletedBoardTasks(): Promise<Array<Task>> {
    try {
      return this.mapTodoistTaskArrayToTaskArray(await this.getCompletedTodayTasks());
    } catch (error) {
      if (import.meta.dev) console.warn('Skipping the completed Todoist tasks of today:', error);
      return [];
    }
  }

  /**
   * This method will mark a Todoist task as completed with the Todoist api
   * @param id ID of the task within Todoist that should be marked as completed
   * @throws On every failure (#168, #159), so `useTaskSync` reports it once and does not record the write
   * as synced. The request timeout is rethrown as is; other errors are wrapped with a "Todoist:" prefix.
   */
  async completeTask(id: string): Promise<void> {
    await this.confirmed(() => this.todoistApi.closeTask(id), `Todoist did not confirm completing task ${id}`);
  }

  /** Reopens a completed Todoist task. Throws on every failure like `completeTask`. */
  async reopenTask(id: string): Promise<void> {
    await this.confirmed(() => this.todoistApi.reopenTask(id), `Todoist did not confirm reopening task ${id}`);
  }

  /**
   * Deletes the task in Todoist. Not recoverable: callers commit it only after the undo window (#99).
   * Throws on failure so the caller can queue (offline) or restore the task.
   */
  async deleteTask(id: string): Promise<void> {
    const isSuccess = await this.todoistApi.deleteTask(id);
    if (!isSuccess) {
      throw new Error(`Todoist did not confirm deleting task ${id}`);
    }
  }

  /**
   * Creates the task in Todoist for a restore from kan-do's trash (#422): due today, so the board fetches it
   * again; the time box as `<n>min` label, the project by the task's topic. A task that was done is completed
   * right after; if only that fails the created task is still returned (the next push corrects the status).
   * Resolves to the new task (its Todoist id as `externalId`). Throws when the task could not be created.
   */
  async createTask(task: Task): Promise<Task> {
    if (!this.todoistProjects.length) this.todoistProjects = await this.getTodoistProjects();
    const project = task.topic ? this.todoistProjects.find((el) => el.name === task.topic) : undefined;
    let created: SdkTask;
    try {
      created = await this.todoistApi.addTask({
        content: task.title,
        ...(task.notes ? { description: task.notes } : {}),
        priority: priorityToTodoist(task.priority),
        ...(task.timeBoxSeconds ? { labels: [`${Math.round(task.timeBoxSeconds / 60)}min`] } : {}),
        ...(project ? { projectId: project.id } : {}),
        dueString: 'today',
      });
    } catch (error) {
      if (isTodoistTimeoutError(error)) throw error;
      const original = error instanceof Error ? error.message : String(error);
      throw new Error(`Todoist: ${original}`, { cause: error });
    }
    const todoistId = created.id.toString();
    if (task.status === TaskStatus.Done) {
      try {
        await this.completeTask(todoistId);
      } catch (error) {
        // The task exists now: rejecting would make a retry create a second one. The next push corrects the status.
        if (import.meta.dev) console.warn('Todoist restore: the task was created but not completed', error);
      }
    }
    return { ...task, id: todoistId, externalId: todoistId, source: 'todoist' };
  }

  private async getOpenTodayTodoistTasks(): Promise<ITodoistTask[]> {
    // Note: getTasks() doesn't support filter parameter in current API version
    // We fetch all tasks and would need to filter client-side if needed
    const response = await this.todoistApi.getTasks();
    if (import.meta.dev) console.log('got active Todoist tasks via REST API...', response);
    return response.results.map((item) => this.toTodoistTask(item));
  }

  /**
   * The tasks completed during the user's local day (API v1 `tasks/completed/by_completion_date`, #343).
   * `since` is inclusive, `until` exclusive; the next day comes from the calendar constructor so a DST
   * change does not shift it. Follows `nextCursor`, capped at `COMPLETED_PAGE_CAP` pages.
   */
  private async getCompletedTodayTasks(): Promise<ITodoistTask[]> {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const tasks: ITodoistTask[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < COMPLETED_PAGE_CAP; page++) {
      const response: { items: SdkTask[]; nextCursor: string | null } =
        await this.todoistApi.getCompletedTasksByCompletionDate({ since, until, cursor, limit: COMPLETED_PAGE_SIZE });
      tasks.push(...response.items.map((item) => this.toTodoistTask(item)));
      if (!response.nextCursor) break;
      cursor = response.nextCursor;
    }
    return tasks;
  }

  /** Maps an SDK task (open or completed) to the shape the board mapper reads. */
  private toTodoistTask(item: SdkTask): ITodoistTask {
    return {
      ...item,
      isCompleted: item.checked,
      createdAt: item.addedAt ?? null,
      assignee: null,
      assigner: null,
      due: null,
      parentId: item.parentId ?? null,
      sectionId: item.sectionId ?? null,
      commentCount: 0,
    };
  }

  private async getTodoistLabels(): Promise<ITodoistLabel[]> {
    const response = await this.todoistApi.getLabels();
    return response.results as ITodoistLabel[];
  }

  private async getTodoistProjects(): Promise<ITodoistProject[]> {
    const response = await this.todoistApi.getProjects();
    return response.results.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      order: p.childOrder,
      commentCount: 0,
      isShared: p.isShared ?? false,
      isFavorite: p.isFavorite,
      isInboxProject: ('inboxProject' in p && Boolean(p.inboxProject)),
      url: p.url,
    }));
  }

  /* HELPER METHODS */

  private mapTodoistTaskArrayToTaskArray(
    todoistArray: Array<ITodoistTask>,
  ): Array<Task> {
    return todoistArray.map((todoistTask) => {
      let timeBoxSeconds: null | number = null;
      // HANDLE TIMEBOX LABELS
      // look for timebox label and set timebox value accordingly:
      todoistTask.labels?.forEach((label) => {
        const minutes = this.parseTimeLabelToMinutes(label);
        if (minutes !== null) {
          timeBoxSeconds = minutes * 60;
        }
      });
      // GET PROJECT INFORMATION
      const project = this.todoistProjects.find(
        (el) => el.id === todoistTask.projectId,
      );
      // FINALLY ADD TASK TO STORE
      const todoistId = todoistTask.id?.toString() ?? null;
      return {
        id: todoistId,
        externalId: todoistId,
        title: todoistTask.content ?? "Ohne Titel",
        notes: todoistTask.description,
        status:
          todoistTask.isCompleted === false ? TaskStatus.Open : TaskStatus.Done,
        priority: todoistToPriority(todoistTask.priority),
        timeBoxSeconds,
        timeSpentSeconds: 0,
        topic: project?.name ?? null,
        topicColorCode: project?.color ?? null,
        activity: null, // Todoist doesn't have activity concept
        timerId: null,
        isUnplanned: false, // TODO: Implement unplanned detection via labels or custom fields
        source: "todoist" as const,
      };
    });
  }

  /**
   * Checks a Todoist label for being a time box label and returns the corresponding number of minutes.
   * @param label - The time label to parse.
   * @returns The number of minutes parsed from the label, or null if no valid time label is found.
   */
  private parseTimeLabelToMinutes(label: string): number | null {
    const matchArray = /([0-9]+)min/gi.exec(label);
    if (matchArray !== null && matchArray[1]) {
      return Number.parseInt(matchArray[1]);
    }
    return null;
  }

  /**
   * Runs a status write and turns every failure into a rejection. The timeout error keeps its identity
   * (`isTodoistTimeoutError` matches the message prefix); anything else mentions Todoist so
   * `getErrorMessageKey` maps it to `errors.todoistSyncFailed` and keeps the original text for `isNetworkError`.
   */
  private async confirmed(write: () => Promise<boolean>, unconfirmedMessage: string): Promise<void> {
    let isSuccess: boolean;
    try {
      isSuccess = await write();
    } catch (error) {
      if (isTodoistTimeoutError(error)) throw error;
      const original = error instanceof Error ? error.message : String(error);
      throw new Error(`Todoist: ${original}`, { cause: error });
    }
    if (!isSuccess) {
      throw new Error(unconfirmedMessage);
    }
  }

  /**
   * Standardized error handling for Todoist integration
   */
  private handleError(error: unknown, errContext: string): void {
    const { handleError } = useErrorHandler();
    handleError(error as Error, 'todoist_setup');
    // Still log to console for debugging
    console.error(`[TodoistIntegration] ${errContext}:`, error);
  }
}
