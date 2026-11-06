import { computed, ref } from 'vue'
import type { Task } from "@/types/task";
import type { SourceId } from "@/types/taskSource";
import { useTasksStore } from "~/store/tasks";
import { useIntegrationHealthStore } from "~/store/integrationHealth";

/**
 * Composable for validating sync results and showing warnings
 * 
 * Provides safeguards against accidental data loss when syncing
 * with external integrations like Notion. Validation is per source: it compares the fetched tasks of one
 * integration with the stored tasks of that same source, and Local tasks never take part (#318).
 *
 * The warning state is shared by every `useSyncValidation()` call (module level): the integration manager awaits the same modal the page renders (#337).
 */

export interface SyncValidationResult {
  isValid: boolean
  needsConfirmation: boolean
  reason?: string
}

/** What the warning modal shows about one source whose sync result looks suspicious. */
export interface SyncWarning {
  source: SourceId | null
  reason: string | null
  /** Stored tasks of that source */
  currentTaskCount: number
  /** Tasks the sync returned for it */
  fetchedCount: number
  /** Epoch ms of the source's last merged sync, `null` if there was none */
  lastSync: number | null
}

interface PendingWarning extends SyncWarning {
  resolve: (confirmed: boolean) => void
}

/**
 * Warnings waiting for the user, oldest first: the head is shown, the others follow when it is answered
 * (two sources can look suspicious in the same refresh).
 */
const queue = ref<PendingWarning[]>([])

const EMPTY_WARNING: SyncWarning = { source: null, reason: null, currentTaskCount: 0, fetchedCount: 0, lastSync: null }

/** Cancels every waiting warning and clears the queue. For tests and for a page that goes away. */
export const resetSyncValidation = () => {
  const waiting = queue.value
  queue.value = []
  waiting.forEach((entry) => entry.resolve(false))
}

export const useSyncValidation = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const tasksStore = useTasksStore()

  /** The warning the modal shows, `null` when none is waiting. */
  const warning = computed<SyncWarning | null>(() => queue.value[0] ?? null)

  /** Whether the warning modal is open. Read-only: it closes by answering the warning. */
  const showWarningModal = computed(() => queue.value.length > 0)

  /**
   * Validates sync results before merging with local data
   * 
   * @param source Source the tasks were fetched from; only that source's stored tasks are compared
   * @param fetchedTasks Tasks fetched from that source
   * @returns Validation result with confirmation requirement
   */
  const validateSyncResult = (source: SourceId, fetchedTasks: Task[]): SyncValidationResult => {
    // Local has no upstream that could return less than it holds
    if (source === 'local') {
      return { isValid: true, needsConfirmation: false }
    }

    const currentTaskCount = tasksStore.tasks.filter((task) => task.source === source).length
    const fetchedCount = fetchedTasks.length

    // No validation needed if we have no local tasks
    if (currentTaskCount === 0) {
      return {
        isValid: true,
        needsConfirmation: false
      }
    }

    // Empty sync result when we have local tasks is suspicious
    if (fetchedCount === 0 && currentTaskCount > 0) {
      return {
        isValid: false,
        needsConfirmation: true,
        reason: 'empty_sync_with_local_data'
      }
    }

    // Significant drop in task count (>80% reduction) is suspicious
    const dropPercentage = ((currentTaskCount - fetchedCount) / currentTaskCount) * 100
    if (fetchedCount > 0 && dropPercentage > 80) {
      return {
        isValid: false,
        needsConfirmation: true,
        reason: 'significant_task_count_drop'
      }
    }

    return {
      isValid: true,
      needsConfirmation: false
    }
  }

  /**
   * Shows the warning modal and waits for user confirmation. A newer warning for the same source
   * replaces a waiting one (the older fetch is stale by then) and cancels it.
   * 
   * @returns Promise that resolves to true if user confirms, false if cancelled
   */
  const requestUserConfirmation = (details: Partial<SyncWarning> = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      const entry: PendingWarning = { ...EMPTY_WARNING, ...details, resolve }
      const replaced = entry.source === null ? [] : queue.value.filter((other) => other.source === entry.source)
      queue.value = [...queue.value.filter((other) => !replaced.includes(other)), entry]
      replaced.forEach((other) => other.resolve(false))
    })
  }

  /**
   * Validates and optionally requests confirmation before syncing
   * 
   * @param source Source the tasks were fetched from
   * @param fetchedTasks Tasks fetched from that source
   * @returns Promise that resolves to true if sync should proceed, false otherwise
   */
  const validateAndConfirm = async (source: SourceId, fetchedTasks: Task[]): Promise<boolean> => {
    const validation = validateSyncResult(source, fetchedTasks)

    if (!validation.needsConfirmation) {
      return true
    }

    if (import.meta.dev) {
      console.warn('[SyncValidation] Suspicious sync result detected:', validation.reason, source)
    }

    // Request user confirmation
    const confirmed = await requestUserConfirmation({
      source,
      reason: validation.reason ?? null,
      currentTaskCount: tasksStore.tasks.filter((task) => task.source === source).length,
      fetchedCount: fetchedTasks.length,
      lastSync: useIntegrationHealthStore().healthOf(source).lastSuccessfulSync,
    })

    if (!confirmed && import.meta.dev) {
      console.log('[SyncValidation] User cancelled suspicious sync')
    }

    return confirmed
  }

  /** Answers the shown warning and brings up the next one, if any. */
  const answer = (confirmed: boolean) => {
    const [head, ...rest] = queue.value
    if (!head) return
    queue.value = rest
    head.resolve(confirmed)
  }

  /**
   * Handles confirmation from the warning modal
   */
  const handleConfirm = () => answer(true)

  /**
   * Handles cancellation from the warning modal
   */
  const handleCancel = () => answer(false)

  return {
    warning,
    showWarningModal,
    validateSyncResult,
    validateAndConfirm,
    requestUserConfirmation,
    handleConfirm,
    handleCancel,
  } as const
}
