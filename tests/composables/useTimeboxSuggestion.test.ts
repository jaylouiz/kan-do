import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimeboxSuggestion } from '~/composables/useTimeboxSuggestion';
import { useTaskStatisticsStore } from '~/store/taskStatistics';
import type { TaskCompletionRecord } from '~/store/taskStatistics';

describe('useTimeboxSuggestion', () => {
  let statisticsStore: ReturnType<typeof useTaskStatisticsStore>;
  let timeboxSuggestion: ReturnType<typeof useTimeboxSuggestion>;

  beforeEach(() => {
    setActivePinia(createPinia());
    statisticsStore = useTaskStatisticsStore();
    timeboxSuggestion = useTimeboxSuggestion();
    
    // Clear any existing records
    statisticsStore.clearAllRecords();
  });

  describe('calculateSuggestion', () => {
    it('should return null when no historic data exists', () => {
      const result = timeboxSuggestion.calculateSuggestion('Test task', 'coding', null);
      expect(result).toBeNull();
    });

    it('should return null when title is too short', () => {
      const result = timeboxSuggestion.calculateSuggestion('ab', 'coding', null);
      expect(result).toBeNull();
    });

    it('should suggest based on title similarity only', () => {
      // Add historic task
      const record: TaskCompletionRecord = {
        taskId: 'task-1',
        title: 'Design anpassen',
        completedAt: new Date(),
        timeBoxSeconds: 1800, // 30 min
        actualTimeSpentSeconds: 2400, // 40 min
        estimationAccuracy: 133,
        activity: 'designing',
        topic: null,
        topicColorCode: null,
        isUnplanned: false,
      };
      statisticsStore.completionRecords.push(record);

      const result = timeboxSuggestion.calculateSuggestion(
        'Design erstellen',
        null, // No activity
        null  // No topic
      );

      expect(result).not.toBeNull();
      expect(result?.suggestedMinutes).toBeGreaterThan(0);
      expect(result?.matchCount).toBe(1);
      expect(result?.similarTasks[0]!.title).toBe('Design anpassen');
    });

    it('should boost score with activity match (3.0x)', () => {
      // Add two tasks: one with matching activity, one without
      const records: TaskCompletionRecord[] = [
        {
          taskId: 'task-1',
          title: 'Code schreiben',
          completedAt: new Date(),
          timeBoxSeconds: 3600,
          actualTimeSpentSeconds: 3000, // 50 min
          estimationAccuracy: 83,
          activity: 'Programmieren',
          topic: null,
          topicColorCode: null,
          isUnplanned: false,
        },
        {
          taskId: 'task-2',
          title: 'Code review',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 1200, // 20 min
          estimationAccuracy: 67,
          activity: 'reviewing',
          topic: null,
          topicColorCode: null,
          isUnplanned: false,
        },
      ];
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Code implementieren',
        'Programmieren', // Matches task-1
        null
      );

      expect(result).not.toBeNull();
      // Task with matching activity should be ranked higher
      expect(result?.similarTasks[0]!.activity).toBe('Programmieren');
    });

    it('should boost score with topic match (1.5x)', () => {
      const records: TaskCompletionRecord[] = [
        {
          taskId: 'task-1',
          title: 'Feature entwickeln',
          completedAt: new Date(),
          timeBoxSeconds: 3600,
          actualTimeSpentSeconds: 3600, // 60 min
          estimationAccuracy: 100,
          activity: 'coding',
          topic: 'Projekt A',
          topicColorCode: '#ff0000',
          isUnplanned: false,
        },
        {
          taskId: 'task-2',
          title: 'Feature testen',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 1800, // 30 min
          estimationAccuracy: 100,
          activity: 'testing',
          topic: 'Projekt B',
          topicColorCode: '#00ff00',
          isUnplanned: false,
        },
      ];
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Feature implementieren',
        null,
        'Projekt A' // Matches task-1
      );

      expect(result).not.toBeNull();
      expect(result?.similarTasks[0]!.topic).toBe('Projekt A');
    });

    it('should give highest score to activity + topic match (4.5x)', () => {
      const records: TaskCompletionRecord[] = [
        {
          taskId: 'task-1',
          title: 'Bericht schreiben',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 2100, // 35 min
          estimationAccuracy: 117,
          activity: 'reporting',
          topic: 'Projekt A',
          topicColorCode: '#ff0000',
          isUnplanned: false,
        },
        {
          taskId: 'task-2',
          title: 'Bericht erstellen',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 1500, // 25 min
          estimationAccuracy: 83,
          activity: 'reporting',
          topic: 'Projekt B',
          topicColorCode: '#00ff00',
          isUnplanned: false,
        },
        {
          taskId: 'task-3',
          title: 'Bericht prüfen',
          completedAt: new Date(),
          timeBoxSeconds: 900,
          actualTimeSpentSeconds: 600, // 10 min
          estimationAccuracy: 67,
          activity: 'reviewing',
          topic: 'Projekt A',
          topicColorCode: '#ff0000',
          isUnplanned: false,
        },
      ];
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Bericht verfassen',
        'reporting',
        'Projekt A'
      );

      expect(result).not.toBeNull();
      // Task-1 should rank highest (both activity and topic match)
      expect(result?.similarTasks[0]!.activity).toBe('reporting');
      expect(result?.similarTasks[0]!.topic).toBe('Projekt A');
      expect(result?.similarTasks[0]!.title).toBe('Bericht schreiben');
    });

    it('should use actual time spent (not timebox) for suggestion', () => {
      const record: TaskCompletionRecord = {
        taskId: 'task-1',
        title: 'API endpoint erstellen',
        completedAt: new Date(),
        timeBoxSeconds: 1800, // Estimated 30 min
        actualTimeSpentSeconds: 3600, // Actually took 60 min
        estimationAccuracy: 200,
        activity: 'coding',
        topic: null,
        topicColorCode: null,
        isUnplanned: false,
      };
      statisticsStore.completionRecords.push(record);

      const result = timeboxSuggestion.calculateSuggestion(
        'API endpoint implementieren',
        'coding',
        null
      );

      expect(result).not.toBeNull();
      // Should suggest based on actual time (60 min), not timebox (30 min)
      expect(result?.suggestedMinutes).toBeGreaterThanOrEqual(55);
      expect(result?.suggestedMinutes).toBeLessThanOrEqual(65);
    });

    it('should round to nearest 5 minutes', () => {
      const record: TaskCompletionRecord = {
        taskId: 'task-1',
        title: 'Task durchführen',
        completedAt: new Date(),
        timeBoxSeconds: 1800,
        actualTimeSpentSeconds: 1320, // 22 minutes
        estimationAccuracy: 73,
        activity: 'working',
        topic: null,
        topicColorCode: null,
        isUnplanned: false,
      };
      statisticsStore.completionRecords.push(record);

      const result = timeboxSuggestion.calculateSuggestion(
        'Task erledigen',
        'working',
        null
      );

      expect(result).not.toBeNull();
      // 22 minutes should round to 20
      expect(result?.suggestedMinutes).toBe(20);
      expect(result!.suggestedMinutes % 5).toBe(0);
    });

    it('should filter out tasks below similarity threshold', () => {
      const records: TaskCompletionRecord[] = [
        {
          taskId: 'task-1',
          title: 'Completely different task',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 1800,
          estimationAccuracy: 100,
          activity: 'other',
          topic: null,
          topicColorCode: null,
          isUnplanned: false,
        },
      ];
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Design anpassen',
        'Programmieren',
        'Projekt A'
      );

      // Should return null because similarity is too low
      expect(result).toBeNull();
    });

    it('should set confidence levels correctly', () => {
      // Add 6 very similar tasks for high confidence
      const records: TaskCompletionRecord[] = Array.from({ length: 6 }, (_, i) => ({
        taskId: `task-${i}`,
        title: 'Design anpassen',
        completedAt: new Date(),
        timeBoxSeconds: 1800,
        actualTimeSpentSeconds: 1800 + i * 60,
        estimationAccuracy: 100,
        activity: 'designing',
        topic: 'UI',
        topicColorCode: null,
        isUnplanned: false,
      }));
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Design anpassen',
        'designing',
        'UI'
      );

      expect(result).not.toBeNull();
      expect(result?.confidence).toBe('high');
      expect(result?.matchCount).toBeGreaterThanOrEqual(5);
    });

    it('should handle German umlauts correctly', () => {
      const record: TaskCompletionRecord = {
        taskId: 'task-1',
        title: 'Präsentation überarbeiten',
        completedAt: new Date(),
        timeBoxSeconds: 1800,
        actualTimeSpentSeconds: 2400,
        estimationAccuracy: 133,
        activity: 'presenting',
        topic: null,
        topicColorCode: null,
        isUnplanned: false,
      };
      statisticsStore.completionRecords.push(record);

      const result = timeboxSuggestion.calculateSuggestion(
        'Präsentation erstellen',
        'presenting',
        null
      );

      expect(result).not.toBeNull();
      expect(result?.similarTasks[0]!.title).toBe('Präsentation überarbeiten');
    });
  });

  describe('Real-world scenario from screenshot', () => {
    it('should suggest for "Design anpassen" with activity "Programmieren"', () => {
      // Add realistic historic data
      const records: TaskCompletionRecord[] = [
        {
          taskId: 'task-1',
          title: 'UI Design anpassen',
          completedAt: new Date(),
          timeBoxSeconds: 2700,
          actualTimeSpentSeconds: 3000, // 50 min
          estimationAccuracy: 111,
          activity: 'Programmieren',
          topic: 'Frontend',
          topicColorCode: '#3b82f6',
          isUnplanned: false,
        },
        {
          taskId: 'task-2',
          title: 'Design überarbeiten',
          completedAt: new Date(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: 2400, // 40 min
          estimationAccuracy: 133,
          activity: 'Programmieren',
          topic: 'UI/UX',
          topicColorCode: '#10b981',
          isUnplanned: false,
        },
        {
          taskId: 'task-3',
          title: 'Layout anpassen',
          completedAt: new Date(),
          timeBoxSeconds: 1500,
          actualTimeSpentSeconds: 1800, // 30 min
          estimationAccuracy: 120,
          activity: 'Programmieren',
          topic: 'Frontend',
          topicColorCode: '#3b82f6',
          isUnplanned: false,
        },
      ];
      statisticsStore.completionRecords.push(...records);

      const result = timeboxSuggestion.calculateSuggestion(
        'Design anpassen',
        'Programmieren',
        null
      );

      console.log('Test result:', JSON.stringify(result, null, 2));

      expect(result).not.toBeNull();
      expect(result?.suggestedMinutes).toBeGreaterThan(0);
      expect(result?.matchCount).toBeGreaterThan(0);
      expect(result?.matchDescription).toContain('Programmieren');
    });
  });
});
