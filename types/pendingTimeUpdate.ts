/**
 * Structured pending time update with sync metadata
 */
export interface PendingTimeUpdate {
  taskId: string;
  timeSpentSeconds: number;
  createdAt: Date;
  lastAttemptAt: Date | null;
  attemptCount: number;
  status: 'pending' | 'syncing' | 'failed';
  errorMessage?: string;
  /** The total was set by the user (#4): it wins over a fetched value, also a higher one, until a push carried it */
  absolute?: boolean;
}

/**
 * Helper to create a new pending update entry
 */
export function createPendingTimeUpdate(
  taskId: string,
  timeSpentSeconds: number
): PendingTimeUpdate {
  return {
    taskId,
    timeSpentSeconds,
    createdAt: new Date(),
    lastAttemptAt: null,
    attemptCount: 0,
    status: 'pending',
  };
}

/**
 * Check if a pending update should be cleaned up (older than 7 days)
 */
export function shouldCleanupPendingUpdate(update: PendingTimeUpdate): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return new Date(update.createdAt) < sevenDaysAgo;
}
