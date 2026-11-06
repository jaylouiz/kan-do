import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTasksStore } from '../../store/tasks';
import { useBoardStore } from '../../store/board';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '../../types/task';
import { mapHelpers } from '../../utils/mapHelpers';

describe('Tasks Store - Time Tracking Merge Behavior', () => {
  let tasksStore: ReturnType<typeof useTasksStore>;
  let boardStore: ReturnType<typeof useBoardStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    tasksStore = useTasksStore();
    boardStore = useBoardStore();
  });

  const createMockTask = (id: string, timeSpent: number = 0, timerId: number | null = null): Task => ({
    id, source: 'notion', externalId: id,
    title: `Task ${id}`,
    notes: null,
    status: TaskStatus.Progress,
    priority: 1,
    activity: null,
    timeBoxSeconds: 3600, // 1 hour
    timeSpentSeconds: timeSpent,
    topic: null,
    topicColorCode: null,
    timerId,
  });

  describe('mergeTasks', () => {
    it('should preserve local time spent when higher than external', () => {
      // Setup: Add task with local time spent
      const localTask = createMockTask('task1', 1800); // 30 minutes local
      tasksStore.addTask(localTask);

      // Simulate external fetch with less time spent
      const externalTask = createMockTask('task1', 900); // 15 minutes external
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timeSpentSeconds).toBe(1800); // Should keep higher local value
      const pendingUpdate = mapHelpers.get(tasksStore.pendingTimeUpdates, 'task1');
      expect(pendingUpdate?.timeSpentSeconds).toBe(1800); // Should add to pending updates
    });

    it('should use external time spent when higher than local', () => {
      // Setup: Add task with local time spent
      const localTask = createMockTask('task1', 900); // 15 minutes local
      tasksStore.addTask(localTask);

      // Simulate external fetch with more time spent
      const externalTask = createMockTask('task1', 1800); // 30 minutes external
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timeSpentSeconds).toBe(1800); // Should use higher external value
      expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'task1')).toBe(false); // No pending update needed
    });

    it('should preserve active timer state during merge', () => {
      // Setup: Add task with active timer
      const localTask = createMockTask('task1', 600, 12345); // 10 minutes, active timer
      tasksStore.addTask(localTask);

      // Simulate external fetch without timer info
      const externalTask = createMockTask('task1', 300, null); // 5 minutes, no timer
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timerId).toBe(12345); // Should preserve local timer
      expect(mergedTask?.timeSpentSeconds).toBe(600); // Should keep higher local time
    });

    it('should handle new tasks from external source', () => {
      // Start with empty store
      expect(tasksStore.tasks.length).toBe(0);

      // Add new task from external source
      const newExternalTask = createMockTask('task1', 1200); // 20 minutes
      tasksStore.mergeTasks('notion', [newExternalTask]);

      expect(tasksStore.tasks.length).toBe(1);
      const addedTask = tasksStore.task('task1');
      expect(addedTask?.timeSpentSeconds).toBe(1200);
      expect(addedTask?.timerId).toBeNull();
    });

    it('should update other task properties from external source', () => {
      // Setup: Add task with local data
      const localTask = createMockTask('task1', 600);
      localTask.title = 'Old Title';
      localTask.status = TaskStatus.Open;
      localTask.priority = 1;
      tasksStore.addTask(localTask);

      // Simulate external fetch with updated properties
      const externalTask = createMockTask('task1', 300);
      externalTask.title = 'Updated Title';
      externalTask.status = TaskStatus.Progress;
      externalTask.priority = 3;
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.title).toBe('Updated Title'); // Should use external title
      expect(mergedTask?.status).toBe(TaskStatus.Progress); // Should use external status
      expect(mergedTask?.priority).toBe(3); // Should use external priority
      expect(mergedTask?.timeSpentSeconds).toBe(600); // Should preserve higher local time
    });

    it('should reconcile board taskOrder when merged task status changed columns', () => {
      const localTask = createMockTask('task1', 600);
      localTask.status = TaskStatus.Progress;
      tasksStore.addTask(localTask);

      boardStore.columns = [
        {
          idClassSuffix: 'open',
          taskStatus: TaskStatus.Open,
          taskOrder: [],
          taskPositions: {},
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'progress',
          taskStatus: TaskStatus.Progress,
          taskOrder: ['task1'],
          taskPositions: { task1: 0 },
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'waiting',
          taskStatus: TaskStatus.Waiting,
          taskOrder: ['task1'],
          taskPositions: { task1: 0 },
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'done',
          taskStatus: TaskStatus.Done,
          taskOrder: [],
          taskPositions: {},
          sorting: { field: 'manual', direction: 'asc' },
        },
      ];

      const fetchedTask = createMockTask('task1', 600);
      fetchedTask.status = TaskStatus.Waiting;

      tasksStore.mergeTasks('notion', [fetchedTask]);

      expect(boardStore.columns[1]?.taskOrder).toEqual([]);
      expect(boardStore.columns[1]?.taskPositions).toEqual({});
      expect(boardStore.columns[2]?.taskOrder).toEqual(['task1']);
      expect(boardStore.columns[2]?.taskPositions).toEqual({ task1: 0 });
    });

    it('should reconcile board taskOrder when setTasks replaces the task set', () => {
      boardStore.columns = [
        {
          idClassSuffix: 'open',
          taskStatus: TaskStatus.Open,
          taskOrder: ['waiting-1'],
          taskPositions: { 'waiting-1': 0 },
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'progress',
          taskStatus: TaskStatus.Progress,
          taskOrder: ['progress-1'],
          taskPositions: { 'progress-1': 0 },
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'waiting',
          taskStatus: TaskStatus.Waiting,
          taskOrder: ['waiting-1'],
          taskPositions: { 'waiting-1': 0 },
          sorting: { field: 'manual', direction: 'asc' },
        },
        {
          idClassSuffix: 'done',
          taskStatus: TaskStatus.Done,
          taskOrder: [],
          taskPositions: {},
          sorting: { field: 'manual', direction: 'asc' },
        },
      ];

      tasksStore.setTasks([
        { id: 'open-1', source: 'local', externalId: null, title: 'Open', status: TaskStatus.Open, priority: 1, notes: null, activity: null, topic: null, topicColorCode: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null },
        { id: 'waiting-1', source: 'local', externalId: null, title: 'Waiting', status: TaskStatus.Waiting, priority: 1, notes: null, activity: null, topic: null, topicColorCode: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null },
      ]);

      expect(boardStore.columns[0]?.taskOrder).toEqual(['open-1']);
      expect(boardStore.columns[0]?.taskPositions).toEqual({});
      expect(boardStore.columns[1]?.taskOrder).toEqual([]);
      expect(boardStore.columns[1]?.taskPositions).toEqual({});
      expect(boardStore.columns[2]?.taskOrder).toEqual(['waiting-1']);
    });

    it('should handle multiple tasks in merge operation', () => {
      // Setup: Add multiple tasks with different time scenarios
      const localTask1 = createMockTask('task1', 1800, 111); // Higher local time, active timer
      const localTask2 = createMockTask('task2', 600); // Lower local time
      tasksStore.addTask(localTask1);
      tasksStore.addTask(localTask2);

      // Simulate external fetch
      const externalTask1 = createMockTask('task1', 900); // Lower external time
      const externalTask2 = createMockTask('task2', 1200); // Higher external time
      const externalTask3 = createMockTask('task3', 300); // New task
      tasksStore.mergeTasks('notion', [externalTask1, externalTask2, externalTask3]);

      // Verify results
      expect(tasksStore.tasks.length).toBe(3);
      
      const mergedTask1 = tasksStore.task('task1');
      expect(mergedTask1?.timeSpentSeconds).toBe(1800); // Preserved higher local
      expect(mergedTask1?.timerId).toBe(111); // Preserved timer
      const pendingUpdate1 = mapHelpers.get(tasksStore.pendingTimeUpdates, 'task1');
      expect(pendingUpdate1?.timeSpentSeconds).toBe(1800);

      const mergedTask2 = tasksStore.task('task2');
      expect(mergedTask2?.timeSpentSeconds).toBe(1200); // Used higher external
      expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'task2')).toBe(false);

      const mergedTask3 = tasksStore.task('task3');
      expect(mergedTask3?.timeSpentSeconds).toBe(300); // New task as-is
    });

    it('should handle zero time spent values correctly', () => {
      // Setup: Add task with zero local time
      const localTask = createMockTask('task1', 0);
      tasksStore.addTask(localTask);

      // Simulate external fetch with time spent
      const externalTask = createMockTask('task1', 600);
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timeSpentSeconds).toBe(600); // Should use external value
      expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'task1')).toBe(false); // No pending update
    });

    it('should not add pending updates for equal time values', () => {
      // Setup: Add task with time spent
      const localTask = createMockTask('task1', 1200);
      tasksStore.addTask(localTask);

      // Simulate external fetch with same time spent
      const externalTask = createMockTask('task1', 1200);
      tasksStore.mergeTasks('notion', [externalTask]);

      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timeSpentSeconds).toBe(1200);
      expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'task1')).toBe(false); // No pending update needed
    });
  });

  describe('Integration with existing time tracking methods', () => {
    it('should work correctly with updateTaskTimespent', async () => {
      // Setup: Add task and merge with external data
      const localTask = createMockTask('task1', 600);
      tasksStore.addTask(localTask);
      
      const externalTask = createMockTask('task1', 300);
      tasksStore.mergeTasks('notion', [externalTask]);

      // Update time spent through existing method
      await tasksStore.updateTaskTimespent({ taskId: 'task1', timeSpentSeconds: 900 });

      const updatedTask = tasksStore.task('task1');
      expect(updatedTask?.timeSpentSeconds).toBe(900);
      const pendingUpdate = mapHelpers.get(tasksStore.pendingTimeUpdates, 'task1');
      expect(pendingUpdate?.timeSpentSeconds).toBe(900); // Should be in pending updates
    });

    it('should preserve pending updates across merges', () => {
      // Setup: Add task and create pending update
      const localTask = createMockTask('task1', 600);
      tasksStore.addTask(localTask);
      tasksStore.addPendingTimeUpdate('task1', 800);

      // Simulate external fetch
      const externalTask = createMockTask('task1', 400);
      tasksStore.mergeTasks('notion', [externalTask]);

      // Should preserve the higher local time and maintain pending update
      const mergedTask = tasksStore.task('task1');
      expect(mergedTask?.timeSpentSeconds).toBe(800); // Higher of local pending vs external
      const pendingUpdate = mapHelpers.get(tasksStore.pendingTimeUpdates, 'task1');
      expect(pendingUpdate?.timeSpentSeconds).toBe(800);
    });
  });
});

describe('tasks store hydration hook', () => {
  async function hydrate() {
    const { createPinia, setActivePinia } = await import('pinia')
    const { createApp } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    return pinia
  }

  afterEach(() => {
    localStorage.removeItem('tasks-store')
    localStorage.removeItem('board-store')
  })

  it('restores tasks unchanged and reconciles stale board order on hydration', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    const { useBoardStore } = await import('~/store/board')
    const { usePropertyOptionsStore } = await import('~/store/propertyOptions')
    const task = {
      id: 't1', source: 'local', externalId: null, status: TaskStatus.Open, title: 'Keep me', activity: null, topic: null, topicColorCode: null,
      priority: 1, notes: null, timeBoxSeconds: 600, timeSpentSeconds: 123, timerId: null,
    }
    localStorage.setItem('tasks-store', JSON.stringify({
      tasks: [task],
      pendingTimeUpdates: { t1: { taskId: 't1', timeSpentSeconds: 123, timestamp: 1, status: 'pending' } },
    }))
    const columns = [
      { taskStatus: TaskStatus.Open, taskOrder: ['stale', 't1', 't1'], taskPositions: {} },
    ]
    localStorage.setItem('board-store', JSON.stringify({ columns }))
    await hydrate()
    const spy = vi.spyOn(usePropertyOptionsStore(), 'extractOptionsFromTasks')
    const boardStore = useBoardStore()
    const store = useTasksStore()
    expect(store.tasks).toHaveLength(1)
    expect(store.tasks[0]?.timeSpentSeconds).toBe(123)
    expect(store.tasks[0]?.timeBoxSeconds).toBe(600)
    expect(store.pendingTimeUpdates['t1']?.timeSpentSeconds).toBe(123)
    const open = boardStore.columns.find(c => c.taskStatus === TaskStatus.Open)
    expect(open?.taskOrder).toEqual(['t1'])
  })

  it('runs extractOptionsFromTasks when restoring from localStorage', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    const { usePropertyOptionsStore } = await import('~/store/propertyOptions')
    localStorage.setItem('tasks-store', JSON.stringify({ tasks: [{ id: 't9', source: 'local', externalId: null, status: TaskStatus.Open, title: 'x', activity: null, topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null }] }))
    await hydrate()
    const spy = vi.spyOn(usePropertyOptionsStore(), 'extractOptionsFromTasks')
    useTasksStore()
    expect(spy).toHaveBeenCalled()
  })

  it('does not wipe persisted board order when no tasks-store exists', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    const { useBoardStore } = await import('~/store/board')
    localStorage.removeItem('tasks-store')
    localStorage.setItem('board-store', JSON.stringify({
      columns: [{ taskStatus: TaskStatus.Open, taskOrder: ['a', 'b'], taskPositions: { a: 1, b: 2 } }],
    }))
    await hydrate()
    const boardStore = useBoardStore()
    useTasksStore()
    const open = boardStore.columns.find(c => c.taskStatus === TaskStatus.Open)
    expect(open?.taskOrder).toEqual(['a', 'b'])
    const saved = JSON.parse(localStorage.getItem('board-store') ?? '{}')
    expect(saved.columns[0].taskOrder).toEqual(['a', 'b'])
  })
})

describe('tasksDonePrevious across midnight', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a task completed "today" moves to the previous group once the day rolls over', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.setSystemTime(new Date(2026, 9, 22, 23, 58, 0))
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useTasksStore } = await import('~/store/tasks')
    const { TaskStatus } = await import('~/types/taskStatus')
    const store = useTasksStore()
    store.addTask({
      id: 'm1', source: 'local', externalId: null, title: 'x', status: TaskStatus.Done, activity: null, topic: null, topicColorCode: null,
      priority: 0, notes: null, timeSpentSeconds: 0, timeBoxSeconds: null, timerId: null,
      completedAt: new Date(2026, 9, 22, 20, 0, 0),
    } as never)
    expect(store.tasksDonePrevious).toHaveLength(0)
    expect(store.tasksDoneToday).toHaveLength(1)
    vi.advanceTimersByTime(5 * 60_000)
    expect(store.tasksDonePrevious).toHaveLength(1)
    expect(store.tasksDoneToday).toHaveLength(0)
  })
})
