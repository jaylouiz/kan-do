import { ref, watch } from 'vue';
import { useNotionIntegration } from '@/composables/useNotionIntegration';
import { useNotionConfigStore } from "@/store/notionConfig";
import { useTaskStatisticsStore } from "@/store/taskStatistics";
import { useBoardStore } from "@/store/board";
import { useErrorHandler } from '@/composables/useErrorHandler';
import { translate } from '~/lib/i18n';

/**
 * Background job interface for tracking backfill operations
 */
interface StatisticsBackfillJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  tasksProcessed?: number;
  tasksAdded?: number;
}

/**
 * Statistics backfill job state persisted in localStorage
 */
interface BackfillState {
  lastDailyRun?: Date;
  lastNotionConfigChange?: Date;
  activeJobs: StatisticsBackfillJob[];
}

/**
 * Composable for handling statistics backfill from archived tasks in Notion
 * 
 * This provides background job functionality to backfill statistics data
 * when Notion integration is configured with an archive status.
 */
export const useStatisticsBackfill = () => {
  // Move store calls inside function to prevent module-level execution
  const notionConfig = useNotionConfigStore();
  const statisticsStore = useTaskStatisticsStore();
  const _boardStore = useBoardStore();
  const { handleError, handleSuccess } = useErrorHandler();

  // Job state management
  const backfillState = ref<BackfillState>({
    activeJobs: [],
  });

  /**
   * Load persisted state from localStorage (call explicitly, not in lifecycle hook)
   */
  const loadPersistedState = () => {
    if (import.meta.client) {
      const persisted = localStorage.getItem('statistics-backfill-state');
      if (persisted) {
        try {
          const parsed = JSON.parse(persisted) as BackfillState;
          backfillState.value = {
            ...parsed,
            // Convert date strings back to Date objects
            lastDailyRun: parsed.lastDailyRun ? new Date(parsed.lastDailyRun) : undefined,
            lastNotionConfigChange: parsed.lastNotionConfigChange ? new Date(parsed.lastNotionConfigChange) : undefined,
            activeJobs: parsed.activeJobs.map(job => ({
              ...job,
              startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
              completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
            })),
          };
        } catch (error) {
          console.warn('Failed to parse backfill state from localStorage:', error);
        }
      }
    }
  };

  // Auto-load persisted state on client side
  if (import.meta.client) {
    loadPersistedState();
  }

  // Persist state changes
  watch(backfillState, (newState) => {
    if (import.meta.client) {
      localStorage.setItem('statistics-backfill-state', JSON.stringify(newState));
    }
  }, { deep: true });

  /**
   * Check if Notion integration has archive status configured
   */
  const hasArchiveStatus = (): boolean => {
    return !!(notionConfig.config?.statusMapping?.archive);
  };

  /**
   * Check if daily backfill should run (runs once per day)
   */
  const shouldRunDailyBackfill = (): boolean => {
    if (!backfillState.value.lastDailyRun) return true;
    
    const now = new Date();
    const lastRun = new Date(backfillState.value.lastDailyRun);
    
    // Check if at least 24 hours have passed
    const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastRun >= 24;
  };

  /**
   * Check if backfill should run due to Notion configuration changes
   */
  const _shouldRunConfigChangeBackfill = (): boolean => {
    if (!backfillState.value.lastNotionConfigChange) return true;
    
    // This would be called when Notion config changes, so we want to run it
    return true;
  };

  /**
   * Create a new backfill job
   */
  const createBackfillJob = (): StatisticsBackfillJob => {
    const job: StatisticsBackfillJob = {
      id: `backfill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
    };
    
    backfillState.value.activeJobs.push(job);
    return job;
  };

  /**
   * Update backfill job status
   */
  const updateJobStatus = (jobId: string, updates: Partial<StatisticsBackfillJob>): void => {
    const job = backfillState.value.activeJobs.find(j => j.id === jobId);
    if (job) {
      Object.assign(job, updates);
      
      // Clean up completed jobs after 1 hour
      if (job.status === 'completed' || job.status === 'failed') {
        setTimeout(() => {
          const index = backfillState.value.activeJobs.findIndex(j => j.id === jobId);
          if (index !== -1) {
            backfillState.value.activeJobs.splice(index, 1);
          }
        }, 60 * 60 * 1000); // 1 hour
      }
    }
  };

  /**
   * Execute statistics backfill from archived Notion tasks
   * @param trigger - The trigger type ('daily', 'config_change', or 'force')
   */
  const executeBackfill = async (trigger: 'daily' | 'config_change' | 'force'): Promise<void> => {
    // Only run if Notion is configured with archive status
    if (!notionConfig.isConfigured || !notionConfig.config || !hasArchiveStatus()) {
      if (import.meta.dev) {
        console.log('[StatisticsBackfill] Skipping backfill: No archive status configured');
        console.log('[StatisticsBackfill] Config state:', {
          isConfigured: notionConfig.isConfigured,
          hasConfig: !!notionConfig.config,
          archiveStatus: notionConfig.config?.statusMapping?.archive
        });
      }
      return;
    }

    // Check if we should run based on trigger type (skip check for 'force')
    if (trigger === 'daily' && !shouldRunDailyBackfill()) {
      if (import.meta.dev) {
        console.log('[StatisticsBackfill] Skipping daily backfill: Already ran within last 24 hours');
      }
      return;
    }

    const job = createBackfillJob();
    
    try {
      updateJobStatus(job.id, { status: 'running', startedAt: new Date() });

      const { createInstance } = useNotionIntegration();
      const notionIntegration = createInstance();

      // Fetch archived tasks from Notion
      const archivedTasks = await notionIntegration.getArchivedTasks();
      
      // Filter for tasks that have completion data
      const completedArchivedTasks = archivedTasks.filter(task => 
        task.completedAt  // Only filter by completion date, not status
      );

      updateJobStatus(job.id, { tasksProcessed: completedArchivedTasks.length });

      const beforeCount = statisticsStore.completionRecords.length;

      // Backfill statistics (the store handles duplicate prevention)
      statisticsStore.syncExistingDoneTasks(completedArchivedTasks, []); // Empty archivedTaskIds since these are from Notion archive

      const afterCount = statisticsStore.completionRecords.length;
      const addedCount = Math.max(0, afterCount - beforeCount);

      updateJobStatus(job.id, { 
        status: 'completed', 
        completedAt: new Date(),
        tasksAdded: addedCount
      });

      // Update trigger timestamps
      if (trigger === 'daily') {
        backfillState.value.lastDailyRun = new Date();
      } else if (trigger === 'config_change') {
        backfillState.value.lastNotionConfigChange = new Date();
      }

      if (import.meta.dev) {
        console.log(`[StatisticsBackfill] Completed ${trigger} backfill: ${addedCount} new tasks added from ${completedArchivedTasks.length} archived tasks`);
      }

      if (addedCount > 0) {
        handleSuccess(translate('statistics.backfillAdded', { n: addedCount }, addedCount));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateJobStatus(job.id, { 
        status: 'failed', 
        completedAt: new Date(),
        errorMessage
      });
      
      handleError(error as Error, 'statistics_backfill');
      
      if (import.meta.dev) {
        console.error(`[StatisticsBackfill] Failed ${trigger} backfill:`, error);
      }
    }
  };

  /**
   * Trigger daily backfill (called by scheduled job or manual trigger)
   */
  const runDailyBackfill = (): Promise<void> => {
    return executeBackfill('daily');
  };

  /**
   * Trigger backfill due to configuration changes
   */
  const runConfigChangeBackfill = (): Promise<void> => {
    return executeBackfill('config_change');
  };

  /**
   * Force backfill regardless of last run time (for manual triggering)
   */
  const forceBackfill = (): Promise<void> => {
    return executeBackfill('force');
  };

  /**
   * Get current backfill job status
   */
  const getActiveJobs = (): StatisticsBackfillJob[] => {
    return backfillState.value.activeJobs.filter(job => job.status === 'running' || job.status === 'pending');
  };

  /**
   * Get backfill history
   */
  const getJobHistory = (): StatisticsBackfillJob[] => {
    return [...backfillState.value.activeJobs].sort((a, b) => 
      (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
    );
  };

  return {
    // Methods
    runDailyBackfill,
    runConfigChangeBackfill,
    forceBackfill,
    executeBackfill,
    
    // State getters
    hasArchiveStatus,
    shouldRunDailyBackfill,
    getActiveJobs,
    getJobHistory,
    
    // Raw state access
    backfillState,
  };
};
