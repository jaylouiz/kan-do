import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { TaskStatus } from '~/types/taskStatus';
import type { Task, TaskCustomEntry, TaskCustomValue } from '~/types/task';
import {
  useTaskDetail,
  formatTaskDuration,
  formatTaskNumber,
  formatDateRange,
  fallbackCustomValue,
  applyCustomValue,
  type CustomDisplayEntry,
} from '~/composables/useTaskDetail';

// Mock the stores after imports
vi.mock('~/store/tasks', () => ({
  useTasksStore: vi.fn(() => ({
    task: vi.fn((id: string) => mockTasks.find(t => t.id === id) ?? null),
    isLoading: false,
  })),
}));

vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: vi.fn(() => ({
    config: mockNotionConfig,
  })),
}));

// Mock data
let mockTasks: Task[] = [];
let mockNotionConfig: { propertyMapping: { customProperties?: Array<{ key: string; name: string; label?: string; type: string; enabled: boolean }> } } | null = null;

describe('useTaskDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockTasks = [];
    mockNotionConfig = null;
  });

  describe('formatTaskDuration', () => {
    it('returns "0 min" for null/undefined/zero', () => {
      expect(formatTaskDuration(null)).toBe('0 min');
      expect(formatTaskDuration(undefined)).toBe('0 min');
      expect(formatTaskDuration(0)).toBe('0 min');
      expect(formatTaskDuration(-10)).toBe('0 min');
    });

    it('returns seconds for values under 60', () => {
      expect(formatTaskDuration(30)).toBe('30s');
      expect(formatTaskDuration(59)).toBe('59s');
    });

    it('returns minutes for values under 1 hour', () => {
      expect(formatTaskDuration(60)).toBe('1 min');
      expect(formatTaskDuration(120)).toBe('2 min');
      expect(formatTaskDuration(3540)).toBe('59 min');
    });

    it('returns hours and minutes for larger values', () => {
      expect(formatTaskDuration(3600)).toBe('1 h'); // Omits zero minutes for cleaner output
      expect(formatTaskDuration(5400)).toBe('1 h 30 min');
      expect(formatTaskDuration(7200)).toBe('2 h'); // Omits zero minutes for cleaner output
    });
  });

  describe('formatTaskNumber', () => {
    it('returns "—" for null/undefined', () => {
      expect(formatTaskNumber(null)).toBe('—');
    });

    it('formats numbers with German locale', () => {
      expect(formatTaskNumber(1234)).toBe('1.234');
      expect(formatTaskNumber(1234567.89)).toBe('1.234.567,89');
    });
  });

  describe('formatDateRange', () => {
    it('returns "—" for null', () => {
      expect(formatDateRange(null)).toBe('—');
    });

    it('formats single date', () => {
      const result = formatDateRange({ start: '2024-01-15' });
      // German locale long format: "15. Januar 2024"
      expect(result).toBe('15. Januar 2024');
    });

    it('formats date range', () => {
      const result = formatDateRange({ start: '2024-01-15', end: '2024-01-20' });
      expect(result).toContain('–');
    });
  });

  describe('fallbackCustomValue', () => {
    it('returns correct fallback for each type', () => {
      expect(fallbackCustomValue('text')).toEqual({ type: 'text', value: null });
      expect(fallbackCustomValue('number')).toEqual({ type: 'number', value: null });
      expect(fallbackCustomValue('checkbox')).toEqual({ type: 'checkbox', value: false });
      expect(fallbackCustomValue('multi_select')).toEqual({ type: 'multi_select', value: [] });
    });
  });

  describe('applyCustomValue', () => {
    const missingText: CustomDisplayEntry = {
      key: 'kommentar',
      name: 'Kommentar',
      propType: 'text',
      value: { type: 'text', value: null },
      isMissing: true,
    };
    const other: TaskCustomEntry = {
      key: 'tags',
      name: 'Tags',
      propType: 'multi_select',
      value: { type: 'multi_select', value: [{ name: 'Alpha' }] },
    };

    it('creates the record when the task has no custom at all', () => {
      const result = applyCustomValue(undefined, missingText, { type: 'text', value: 'Hallo' });
      expect(result).toEqual({
        kommentar: {
          key: 'kommentar',
          name: 'Kommentar',
          propType: 'text',
          value: { type: 'text', value: 'Hallo' },
        },
      });
    });

    it('never persists isMissing', () => {
      const result = applyCustomValue(undefined, missingText, { type: 'text', value: 'Hallo' });
      expect(result?.kommentar).not.toHaveProperty('isMissing');
    });

    it('keeps other keys untouched when custom exists but lacks the key', () => {
      const result = applyCustomValue({ tags: other }, missingText, { type: 'text', value: 'Hallo' });
      expect(result?.tags).toBe(other);
      expect(result?.kommentar?.value).toEqual({ type: 'text', value: 'Hallo' });
    });

    it('updates an existing entry, including clearing it', () => {
      const existing: TaskCustomEntry = { ...missingText, value: { type: 'text', value: 'Alt' } };
      delete (existing as { isMissing?: boolean }).isMissing;
      const updated = applyCustomValue({ kommentar: existing }, existing, { type: 'text', value: 'Neu' });
      expect(updated?.kommentar?.value).toEqual({ type: 'text', value: 'Neu' });
      const cleared = applyCustomValue({ kommentar: existing }, existing, { type: 'text', value: '' });
      expect(cleared?.kommentar?.value).toEqual({ type: 'text', value: '' });
    });

    it('does not mutate its input', () => {
      const input = { tags: other };
      const snapshot = JSON.parse(JSON.stringify(input));
      const result = applyCustomValue(input, missingText, { type: 'text', value: 'Hallo' });
      expect(input).toEqual(snapshot);
      expect(result).not.toBe(input);
    });

    it.each<[CustomDisplayEntry['propType'], TaskCustomValue, TaskCustomValue]>([
      ['text', { type: 'text', value: 'x' }, { type: 'text', value: '' }],
      ['text', { type: 'text', value: 'x' }, { type: 'text', value: null }],
      ['number', { type: 'number', value: 3 }, { type: 'number', value: null }],
      ['url', { type: 'url', value: 'https://a.b' }, { type: 'url', value: '' }],
      ['email', { type: 'email', value: 'a@b.c' }, { type: 'email', value: null }],
      ['phone_number', { type: 'phone_number', value: '1' }, { type: 'phone_number', value: null }],
      ['select', { type: 'select', value: { name: 'A' } }, { type: 'select', value: null }],
      ['multi_select', { type: 'multi_select', value: [{ name: 'A' }] }, { type: 'multi_select', value: [] }],
      ['date', { type: 'date', value: { start: '2026-01-01' } }, { type: 'date', value: null }],
      ['checkbox', { type: 'checkbox', value: true }, { type: 'checkbox', value: false }],
    ])('is a no-op for an empty %s value on a missing entry', (propType, filled, empty) => {
      const missing: CustomDisplayEntry = {
        key: 'k',
        name: 'K',
        propType,
        value: fallbackCustomValue(propType),
        isMissing: true,
      };
      expect(applyCustomValue(undefined, missing, empty)).toBeNull();
      expect(applyCustomValue({ tags: other }, missing, empty)).toBeNull();
      const result = applyCustomValue(undefined, missing, filled);
      expect(result?.k).toEqual({ key: 'k', name: 'K', propType, value: filled });
    });
  });

  describe('composable return values', () => {
    it('returns null task when taskId is null', () => {
      const taskIdRef = ref<string | null>(null);
      const { task, isError } = useTaskDetail(taskIdRef);

      expect(task.value).toBeNull();
      expect(isError.value).toBe(false);
    });

    it('returns task when found in store', () => {
      const testTask: Task = {
        id: 'task-1', source: 'local', externalId: null,
        title: 'Test Task',
        status: TaskStatus.Progress,
        priority: 2,
        notes: 'Some notes',
        timeBoxSeconds: 3600,
        timeSpentSeconds: 1800,
        timerId: null,
        topic: 'Development',
        topicColorCode: 'blue',
        activity: 'Coding',
      };
      mockTasks = [testTask];

      const taskIdRef = ref<string | null>('task-1');
      const {
        task,
        statusLabel,
        statusBadgeColor,
        priorityLabel,
        timeSpentSummary,
        timeSpentText,
        timeBoxText,
        remainingTimeText,
      } = useTaskDetail(taskIdRef);

      expect(task.value).toEqual(testTask);
      expect(statusLabel.value).toBe('Jetzt');
      expect(statusBadgeColor.value).toBe('info');
      expect(priorityLabel.value).toBe('Normal');
      expect(timeSpentSummary.value).toBe('30 min von 1 h'); // formatTaskDuration omits zero minutes
      expect(timeSpentText.value).toBe('30 min');
      expect(timeBoxText.value).toBe('1 h'); // formatTaskDuration omits zero minutes
      expect(remainingTimeText.value).toBe('30 min');
    });

    it('has no source name for a Local task and the display name for an integration task', () => {
      const base: Task = {
        id: 'task-1', source: 'local', externalId: null,
        title: 'T', status: TaskStatus.Open, priority: 1, notes: null, timeBoxSeconds: null,
        timeSpentSeconds: 0, timerId: null, topic: null, topicColorCode: null, activity: null,
      };
      mockTasks = [base, { ...base, id: 'task-2', source: 'notion', externalId: 'task-2' }];

      expect(useTaskDetail(ref<string | null>('task-1')).taskSource.value).toBeNull();
      expect(useTaskDetail(ref<string | null>('task-2')).taskSource.value).toBe('Notion');
    });

    it('returns correct status info for each status', () => {
      const statuses = [
        { status: TaskStatus.Open, label: 'Offen', color: 'neutral' },
        { status: TaskStatus.Progress, label: 'Jetzt', color: 'info' },
        { status: TaskStatus.Waiting, label: 'Wartet', color: 'warning' },
        { status: TaskStatus.Done, label: 'Erledigt', color: 'success' },
        { status: TaskStatus.Backlog, label: 'Backlog', color: 'secondary' },
      ];

      for (const { status, label, color } of statuses) {
        mockTasks = [{
          id: 'task-1', source: 'local', externalId: null,
          title: 'Test',
          status,
          priority: 1,
          notes: null,
          timeBoxSeconds: null,
          timeSpentSeconds: 0,
          timerId: null,
          topic: null,
          topicColorCode: null,
          activity: null,
        }];

        const taskIdRef = ref<string | null>('task-1');
        const { statusLabel, statusBadgeColor } = useTaskDetail(taskIdRef);

        expect(statusLabel.value).toBe(label);
        expect(statusBadgeColor.value).toBe(color);
      }
    });

    it('returns correct priority labels', () => {
      const priorities = [
        { priority: 1, label: 'Niedrig' },
        { priority: 2, label: 'Normal' },
        { priority: 3, label: 'Hoch' },
        // The former 4th level reads as High (#617)
        { priority: 4, label: 'Hoch' },
      ];

      for (const { priority, label } of priorities) {
        mockTasks = [{
          id: 'task-1', source: 'local', externalId: null,
          title: 'Test',
          status: TaskStatus.Open,
          priority,
          notes: null,
          timeBoxSeconds: null,
          timeSpentSeconds: 0,
          timerId: null,
          topic: null,
          topicColorCode: null,
          activity: null,
        }];

        const taskIdRef = ref<string | null>('task-1');
        const { priorityLabel } = useTaskDetail(taskIdRef);

        expect(priorityLabel.value).toBe(label);
      }
    });

    it('handles custom properties correctly', () => {
      mockNotionConfig = {
        propertyMapping: {
          customProperties: [
            { key: 'urgency', name: 'Urgency', label: 'Dringlichkeit', type: 'select', enabled: true },
            { key: 'tags', name: 'Tags', type: 'multi_select', enabled: true },
          ],
        },
      };

      mockTasks = [{
        id: 'task-1', source: 'notion', externalId: 'task-1',
        title: 'Test',
        status: TaskStatus.Open,
        priority: 1,
        notes: null,
        timeBoxSeconds: null,
        timeSpentSeconds: 0,
        timerId: null,
        topic: null,
        topicColorCode: null,
        activity: null,
        custom: {
          urgency: {
            key: 'urgency',
            name: 'Urgency',
            propType: 'select',
            value: { type: 'select', value: { name: 'High', color: 'red' } },
          },
        },
      }];

      const taskIdRef = ref<string | null>('task-1');
      const { hasCustom, customList } = useTaskDetail(taskIdRef);

      expect(hasCustom.value).toBe(true);
      expect(customList.value.length).toBe(2);
      
      // Check that configured label is used
      const urgencyEntry = customList.value.find(e => e.key === 'urgency');
      expect(urgencyEntry?.name).toBe('Dringlichkeit');
      expect(urgencyEntry?.isMissing).toBe(false);

      // Check that missing property has fallback
      const tagsEntry = customList.value.find(e => e.key === 'tags');
      expect(tagsEntry?.isMissing).toBe(true);
    });

    it('shows no custom properties for a Local task, even with Notion properties configured (#325)', () => {
      mockNotionConfig = {
        propertyMapping: { customProperties: [{ key: 'urgency', name: 'Urgency', type: 'select', enabled: true }] },
      };
      const base: Task = {
        id: 'local-1', source: 'local', externalId: null, title: 'Local', status: TaskStatus.Open, priority: 1, notes: null,
        timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, topic: null, topicColorCode: null, activity: null, custom: {},
      };
      mockTasks = [base, { ...base, id: 'notion-1', source: 'notion', externalId: 'notion-1' }];

      const local = useTaskDetail(ref<string | null>('local-1'));
      expect(local.hasCustom.value).toBe(false);
      expect(local.customList.value).toEqual([]);

      const notion = useTaskDetail(ref<string | null>('notion-1'));
      expect(notion.hasCustom.value).toBe(true);
      expect(notion.customList.value.map(e => e.key)).toEqual(['urgency']);
    });
  });
});
