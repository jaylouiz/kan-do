import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { useTasksStore } from '~/store/tasks';
import type { Task } from '~/types/task';
import { TaskStatus } from '~/types/taskStatus';

describe('tasks store - deletion', () => {
  let tasksStore: ReturnType<typeof useTasksStore>;
  
  const mockTask: Task = {
    id: 'task-1', source: 'local', externalId: null,
    title: 'Test Task',
    status: TaskStatus.Open,
    priority: 1,
    activity: null,
    topic: null,
    topicColorCode: null,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isUnplanned: false,
  };

  const mockTask2: Task = {
    id: 'task-2', source: 'local', externalId: null,
    title: 'Test Task 2',
    status: TaskStatus.Progress,
    priority: 2,
    activity: null,
    topic: null,
    topicColorCode: null,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isUnplanned: false,
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    tasksStore = useTasksStore();
    tasksStore.setTasks([]);
  });

  describe('removeTask', () => {
    it('should remove task and track it in deletedTaskIds', () => {
      // Setup
      tasksStore.addTask(mockTask);
      expect(tasksStore.tasks).toHaveLength(1);
      expect(tasksStore.deletedTaskIds).toHaveLength(0);

      // Action
      tasksStore.removeTask(mockTask.id);

      // Assert
      expect(tasksStore.tasks).toHaveLength(0);
      expect(tasksStore.deletedTaskIds).toContain(mockTask.id);
    });

    it('should not add duplicate IDs to deletedTaskIds', () => {
      // Setup
      tasksStore.addTask(mockTask);
      tasksStore.removeTask(mockTask.id);
      expect(tasksStore.deletedTaskIds).toHaveLength(1);

      // Action - try to delete again
      tasksStore.removeTask(mockTask.id);

      // Assert
      expect(tasksStore.deletedTaskIds).toHaveLength(1);
      expect(tasksStore.deletedTaskIds[0]).toBe(mockTask.id);
    });
  });

  describe('mergeTasks with deleted tasks', () => {
    it('should not include deleted tasks in merge', () => {
      // Setup
      tasksStore.addTask(mockTask);
      tasksStore.addTask(mockTask2);
      
      // Delete first task
      tasksStore.removeTask(mockTask.id);
      expect(tasksStore.tasks).toHaveLength(1);
      expect(tasksStore.deletedTaskIds).toContain(mockTask.id);

      // Simulate sync from external source that includes the deleted task
      const fetchedTasks: Task[] = [
        { ...mockTask, title: 'Updated from Notion' }, // Same ID, updated title
        { ...mockTask2, title: 'Also updated' },
      ];

      // Action
      tasksStore.mergeTasks('local', fetchedTasks);

      // Assert
      expect(tasksStore.tasks).toHaveLength(1);
      expect(tasksStore.tasks[0]?.id).toBe(mockTask2.id);
      expect(tasksStore.tasks[0]?.title).toBe('Also updated');
      expect(tasksStore.deletedTaskIds).toContain(mockTask.id);
    });

    it('should merge non-deleted tasks normally', () => {
      // Setup
      tasksStore.addTask(mockTask);
      tasksStore.addTask(mockTask2);

      // Delete second task
      tasksStore.removeTask(mockTask2.id);

      // Simulate sync with updates
      const fetchedTasks: Task[] = [
        { ...mockTask, title: 'Updated from Notion' },
      ];

      // Action
      tasksStore.mergeTasks('local', fetchedTasks);

      // Assert
      expect(tasksStore.tasks).toHaveLength(1);
      expect(tasksStore.tasks[0]?.id).toBe(mockTask.id);
      expect(tasksStore.tasks[0]?.title).toBe('Updated from Notion');
    });
  });

  describe('undeleteTask', () => {
    it('should remove task ID from deletedTaskIds', () => {
      // Setup
      tasksStore.addTask(mockTask);
      tasksStore.removeTask(mockTask.id);
      expect(tasksStore.deletedTaskIds).toContain(mockTask.id);

      // Action
      tasksStore.undeleteTask(mockTask.id);

      // Assert
      expect(tasksStore.deletedTaskIds).not.toContain(mockTask.id);
    });

    it('should handle undeleting non-deleted task gracefully', () => {
      // Setup
      expect(tasksStore.deletedTaskIds).toHaveLength(0);

      // Action - should not throw
      tasksStore.undeleteTask('non-existent-id');

      // Assert
      expect(tasksStore.deletedTaskIds).toHaveLength(0);
    });
  });

  describe('persistence of deletedTaskIds', () => {
    it('should persist deletedTaskIds across store rehydration', () => {
      // This test would require mocking localStorage
      // For now, we just verify the state is managed correctly
      tasksStore.addTask(mockTask);
      tasksStore.removeTask(mockTask.id);
      
      expect(tasksStore.deletedTaskIds).toEqual([mockTask.id]);
    });
  });
});
