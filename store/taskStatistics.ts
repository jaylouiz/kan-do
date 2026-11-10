import { defineStore, acceptHMRUpdate  } from "pinia";
import { ref, computed } from "vue";
import type { Task } from "@/types/task";
import type { PersistenceOptions } from 'pinia-plugin-persistedstate';
import { reviveDate } from "~/lib/taskDates";
import { isDemoTaskId } from "~/lib/demoIds";
import { renameField, type NameKind } from "~/lib/topicNames";
import { TaskStatus } from "~/types/taskStatus";
import { dayKey, isValidDayKey } from "~/utils/recapDay";
import { cleanWorkSessions, extendSession, isWorkSession, openSession, type WorkSession } from "~/lib/workSessions";

export interface TaskCompletionRecord {
  taskId: string;
  title: string;
  completedAt: Date;
  timeBoxSeconds: number | null;
  actualTimeSpentSeconds: number;
  estimationAccuracy: number | null; // percentage: actual/estimated * 100, null if no timebox
  topic: string | null;
  topicColorCode: string | null;
  activity: string | null;
  isUnplanned: boolean;
}

/** Time tracked on a task that was deleted before it was completed (#537). `deletedAt` is epoch ms (no date revival). */
export interface DiscardedTimeRecord {
  taskId: string;
  deletedAt: number;
  seconds: number;
}

/** Day-end counts and discarded time are kept this long; the Statistik page reads 8 weeks (#537). */
export const STATISTICS_EXTRA_RETENTION_DAYS = 120;
const DAY_MS = 86_400_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Task Statistics store for tracking task completion data and estimation accuracy
 */
export const useTaskStatisticsStore = defineStore("taskStatistics", () => {
  // State
  const completionRecords = ref<TaskCompletionRecord[]>([]);
  /**
   * Tasks in Offen + Jetzt + Wartet by local day (`YYYY-MM-DD`): the last count the app saw that day (#537).
   * A missing key in stored data hydrates to {}; a day the app was not open has no key.
   */
  const dayEndInFlight = ref<Record<string, number>>({});
  /** Tracked time of tasks deleted before completion (#537). A missing key in stored data hydrates to []. */
  const discardedTime = ref<DiscardedTimeRecord[]>([]);
  /**
   * Spans in which a Jetzt timer ran, oldest first (#600): the "when do I work" data of the Statistik page. Written by
   * `composables/useWorkSessionTracking` (open / heartbeat), never from the timer tick. A missing key in stored data hydrates to [].
   */
  const workSessions = ref<WorkSession[]>([]);

  // Getters
  /**
   * Get all completion records sorted by completion date (newest first)
   */
  const allCompletions = computed((): TaskCompletionRecord[] => {
    return [...completionRecords.value].sort((a, b) => 
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  });

  // Actions
  /**
   * Record a task completion
   */
  function recordTaskCompletion(task: Task): void {
    // Calculate estimation accuracy
    let estimationAccuracy: number | null = null;
    if (task.timeBoxSeconds && task.timeBoxSeconds > 0) {
      estimationAccuracy = (task.timeSpentSeconds / task.timeBoxSeconds) * 100;
    }

    const record: TaskCompletionRecord = {
      taskId: task.id,
      title: task.title,
      completedAt: new Date(),
      timeBoxSeconds: task.timeBoxSeconds,
      actualTimeSpentSeconds: task.timeSpentSeconds,
      estimationAccuracy,
      topic: task.topic,
      topicColorCode: task.topicColorCode,
      activity: task.activity,
      isUnplanned: task.isUnplanned ?? false,
    };

    // Remove any existing record for this task (in case of re-completion)
    removeTaskRecord(task.id);
    
    // Add new record
    completionRecords.value.push(record);
    
    console.log(`Recorded completion for task: ${task.title}`, record);
  }

  /**
   * Add mock data for development/testing purposes
   */
  function addMockData(): void {
    const mockTasks = [
      { title: "Implement user authentication", topic: "Backend", topicColor: "#3b82f6" },
      { title: "Design landing page", topic: "Frontend", topicColor: "#10b981" },
      { title: "Write API documentation", topic: "Documentation", topicColor: "#f59e0b" },
      { title: "Fix responsive layout", topic: "Frontend", topicColor: "#10b981" },
      { title: "Optimize database queries", topic: "Backend", topicColor: "#3b82f6" },
      { title: "Add unit tests", topic: "Testing", topicColor: "#8b5cf6" },
      { title: "Update deployment scripts", topic: "DevOps", topicColor: "#ef4444" },
      { title: "Review pull requests", topic: "Code Review", topicColor: "#6b7280" },
      { title: "Plan sprint retrospective", topic: "Management", topicColor: "#ec4899" },
      { title: "Research new frameworks", topic: "Research", topicColor: "#14b8a6" },
      { title: "Update user interface", topic: "Frontend", topicColor: "#10b981" },
      { title: "Configure monitoring", topic: "DevOps", topicColor: "#ef4444" },
      { title: "Write integration tests", topic: "Testing", topicColor: "#8b5cf6" },
      { title: "Refactor legacy code", topic: "Backend", topicColor: "#3b82f6" },
      { title: "Create user onboarding", topic: "UX", topicColor: "#f97316" }
    ];

    const now = new Date();
    const records: TaskCompletionRecord[] = [];

    // Generate records for the last 30 days
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      // Random number of tasks per day (0-3)
      const tasksPerDay = Math.floor(Math.random() * 4);
      
      for (let j = 0; j < tasksPerDay; j++) {
        const mockTask = mockTasks[Math.floor(Math.random() * mockTasks.length)];
        const timeBoxSeconds = Math.floor(Math.random() * 7200) + 1800; // 30min to 2.5h
        const actualTimeSpentSeconds = Math.floor(
          timeBoxSeconds * (0.5 + Math.random() * 1.5) // 50% to 150% of estimate
        );
        
        const completedAt = new Date(date);
        completedAt.setHours(
          9 + Math.floor(Math.random() * 8), // 9 AM to 5 PM
          Math.floor(Math.random() * 60),
          Math.floor(Math.random() * 60)
        );

        const estimationAccuracy = (actualTimeSpentSeconds / timeBoxSeconds) * 100;

        records.push({
          taskId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: mockTask!.title,
          completedAt,
          timeBoxSeconds,
          actualTimeSpentSeconds,
          estimationAccuracy,
          topic: mockTask!.topic,
          topicColorCode: mockTask!.topicColor,
          activity: null, // Mock tasks don't have activities
          isUnplanned: Math.random() > 0.7, // 30% of mock tasks are unplanned
        });
      }
    }

    // Add records to store
    completionRecords.value.push(...records);
    
    console.log(`Added ${records.length} mock completion records`);
  }

  /**
   * Rewrites a topic or activity name on the completion records (#430), so the timebox suggestion and the
   * breakdown keep matching. Returns how many records changed.
   */
  function renameValue(kind: NameKind, from: string, to: string): number {
    let changed = 0;
    const next = completionRecords.value.map((record) => {
      const renamed = renameField(record, kind, from, to);
      if (renamed !== record) changed += 1;
      return renamed;
    });
    if (changed > 0) completionRecords.value = next;
    return changed;
  }

  /**
   * Update a task completion record (when task data changes after completion)
   */
  function updateTaskRecord(task: Task): void {
    const existingIndex = completionRecords.value.findIndex(r => r.taskId === task.id);
    
    if (existingIndex !== -1) {
      // Calculate new estimation accuracy
      let estimationAccuracy: number | null = null;
      if (task.timeBoxSeconds && task.timeBoxSeconds > 0) {
        estimationAccuracy = (task.timeSpentSeconds / task.timeBoxSeconds) * 100;
      }

      // Update the existing record
      const existingRecord = completionRecords.value[existingIndex];
      if (!existingRecord) return;
      
      const updatedRecord: TaskCompletionRecord = {
        taskId: existingRecord.taskId,
        completedAt: existingRecord.completedAt,
        title: task.title,
        timeBoxSeconds: task.timeBoxSeconds,
        actualTimeSpentSeconds: task.timeSpentSeconds,
        estimationAccuracy,
        topic: task.topic,
        topicColorCode: task.topicColorCode,
        activity: task.activity,
        isUnplanned: task.isUnplanned ?? false,
      };

      completionRecords.value[existingIndex] = updatedRecord;
      
      console.log(`Updated completion record for task: ${task.title}`, updatedRecord);
    }
  }

  /**
   * Move a task's completion record to another time (kd#131: the user corrected the done day), so every
   * statistic counts the task and its time on that day. Archived tasks keep their record, so they follow too.
   * @returns false when the task has no record
   */
  function setCompletionDate(taskId: string, completedAt: Date): boolean {
    const index = completionRecords.value.findIndex(r => r.taskId === taskId);
    const existing = completionRecords.value[index];
    if (!existing || Number.isNaN(completedAt.getTime())) return false;
    completionRecords.value[index] = { ...existing, completedAt };
    return true;
  }

  /**
   * Remove a task completion record
   */
  function removeTaskRecord(taskId: string): void {
    const index = completionRecords.value.findIndex(r => r.taskId === taskId);
    if (index !== -1) {
      completionRecords.value.splice(index, 1);
    }
  }

  /**
   * Remember how many tasks were in flight on a day; the last write of a day wins (#537).
   * Days older than STATISTICS_EXTRA_RETENTION_DAYS before the newest key are dropped.
   */
  function recordDayEnd(day: string, count: number): void {
    if (!isValidDayKey(day) || !Number.isFinite(count) || count < 0) return;
    const merged: Record<string, number> = { ...dayEndInFlight.value, [day]: Math.round(count) };
    const newest = Object.keys(merged).sort().at(-1) ?? day;
    const [y, m, d] = newest.split('-').map(Number) as [number, number, number];
    const cutoffKey = dayKey(new Date(y, m - 1, d - STATISTICS_EXTRA_RETENTION_DAYS));
    const next = Object.fromEntries(Object.entries(merged).filter(([key]) => key >= cutoffKey));
    dayEndInFlight.value = next;
  }

  /**
   * Keep the tracked time of a task that is deleted before completion (#537). A Done task keeps its completion
   * record, a task without tracked time and a demo task leave nothing. A re-delete of the same task replaces its entry.
   */
  function recordDiscardedTime(task: Task, at: number = Date.now()): void {
    if (task.status === TaskStatus.Done || isDemoTaskId(task.id)) return;
    if (!Number.isFinite(task.timeSpentSeconds) || task.timeSpentSeconds <= 0) return;
    const cutoff = at - STATISTICS_EXTRA_RETENTION_DAYS * DAY_MS;
    discardedTime.value = [
      ...discardedTime.value.filter(r => r.taskId !== task.id && r.deletedAt >= cutoff),
      { taskId: task.id, deletedAt: at, seconds: task.timeSpentSeconds },
    ];
  }

  /** The time lives on the task again (restored from the trash). */
  function removeDiscardedTime(taskId: string): void {
    if (discardedTime.value.some(r => r.taskId === taskId)) {
      discardedTime.value = discardedTime.value.filter(r => r.taskId !== taskId);
    }
  }

  /**
   * Open a work session at `at`, or continue the previous one when it ended less than 3 minutes ago (#600).
   * Entries older than STATISTICS_EXTRA_RETENTION_DAYS are pruned. @returns the `start` that names the session
   */
  function openWorkSession(at: number = Date.now()): number {
    const opened = openSession(workSessions.value, at, STATISTICS_EXTRA_RETENTION_DAYS * DAY_MS);
    workSessions.value = opened.sessions;
    return opened.start;
  }

  /** Move the end of the session that began at `start` forward to `at` (#600). */
  function extendWorkSession(start: number, at: number = Date.now()): void {
    const next = extendSession(workSessions.value, start, at);
    if (next !== workSessions.value) workSessions.value = next;
  }

  /**
   * Clear all statistics data
   */
  function clearAllRecords(): void {
    completionRecords.value = [];
    dayEndInFlight.value = {};
    discardedTime.value = [];
    workSessions.value = [];
  }

  /**
   * Sync existing Done tasks to statistics store
   * This backfills completion records for tasks that were already done
   * but not yet tracked in statistics (e.g., loaded from integrations or completed before tracking was added)
   */
  function syncExistingDoneTasks(doneTasks: Task[], archivedTaskIds: string[]): void {
    let addedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let noTimestampCount = 0;
    
    doneTasks.forEach(task => {
      // Skip archived tasks (local archive, not Notion archive)
      if (archivedTaskIds.includes(task.id)) {
        skippedCount++;
        return;
      }
      
      // The demo board's sample completions are not real work (#527)
      if (isDemoTaskId(task.id)) {
        skippedCount++;
        return;
      }

      // Only process if task has a completedAt timestamp
      if (!task.completedAt) {
        noTimestampCount++;
        return;
      }
      
      // Calculate estimation accuracy
      let estimationAccuracy: number | null = null;
      if (task.timeBoxSeconds && task.timeBoxSeconds > 0 && task.timeSpentSeconds > 0) {
        estimationAccuracy = (task.timeSpentSeconds / task.timeBoxSeconds) * 100;
      }
      
      // Check if already recorded
      const existingIndex = completionRecords.value.findIndex(r => r.taskId === task.id);
      
      if (existingIndex !== -1) {
        // Update existing record with correct completedAt from source (Notion)
        // This fixes records that were previously synced with wrong dates
        const existing = completionRecords.value[existingIndex];
        if (existing) {
          existing.completedAt = task.completedAt;
          existing.timeBoxSeconds = task.timeBoxSeconds;
          existing.actualTimeSpentSeconds = task.timeSpentSeconds;
          existing.estimationAccuracy = estimationAccuracy;
          existing.topic = task.topic;
          existing.topicColorCode = task.topicColorCode;
          existing.activity = task.activity;
          existing.isUnplanned = task.isUnplanned ?? false;
          updatedCount++;
        }
        return;
      }
      
      const record: TaskCompletionRecord = {
        taskId: task.id,
        title: task.title,
        completedAt: task.completedAt,
        timeBoxSeconds: task.timeBoxSeconds,
        actualTimeSpentSeconds: task.timeSpentSeconds,
        estimationAccuracy,
        topic: task.topic,
        topicColorCode: task.topicColorCode,
        activity: task.activity,
        isUnplanned: task.isUnplanned ?? false,
      };
      
      completionRecords.value.push(record);
      addedCount++;
    });
    
    if (import.meta.dev && (addedCount > 0 || updatedCount > 0)) {
      console.log(`[Statistics] Backfill summary: Added ${addedCount}, Updated ${updatedCount}, Skipped ${skippedCount}, No timestamp ${noTimestampCount}`);
    }
  }

  return {
    // State
    completionRecords,
    dayEndInFlight,
    discardedTime,
    workSessions,

    // Getters
    allCompletions,
    
    // Actions
    recordTaskCompletion,
    addMockData,
    updateTaskRecord,
    setCompletionDate,
    renameValue,
    removeTaskRecord,
    clearAllRecords,
    recordDayEnd,
    recordDiscardedTime,
    removeDiscardedTime,
    openWorkSession,
    extendWorkSession,
    syncExistingDoneTasks,
  };
}, {
  persist: {
    // Storage holds ISO strings (#376). Reviving is not a stored-shape change: no $persist here (#273).
    // A present but wrongly shaped #537 field (null, a string, an array for the map, ...) from a hand-edited or imported
    // data file falls back to its default, so no reader or action throws on it.
    afterHydrate: (ctx: { store: { completionRecords?: TaskCompletionRecord[]; dayEndInFlight?: unknown; discardedTime?: unknown; workSessions?: unknown } }) => {
      const { store } = ctx;
      if (!isPlainObject(store.dayEndInFlight)) store.dayEndInFlight = {};
      if (!Array.isArray(store.discardedTime)) store.discardedTime = [];
      else if (!store.discardedTime.every(isPlainObject)) store.discardedTime = store.discardedTime.filter(isPlainObject);
      // #600: a missing, wrongly shaped or partly malformed list reads as the usable entries (none at worst)
      if (!Array.isArray(store.workSessions) || !store.workSessions.every(isWorkSession)) store.workSessions = cleanWorkSessions(store.workSessions);
      const records = store.completionRecords;
      if (!records?.some(record => !(record.completedAt instanceof Date))) return;
      store.completionRecords = records.map(record =>
        record.completedAt instanceof Date ? record : { ...record, completedAt: reviveDate(record.completedAt) ?? new Date(0) });
    },
  } as PersistenceOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTaskStatisticsStore, import.meta.hot));
}
