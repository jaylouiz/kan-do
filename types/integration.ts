import type { IntegrationSourceId } from '~/types/taskSource';

export type IntegrationHealth = 'unconfigured' | 'healthy' | 'degraded' | 'broken' | 'offline';

/**
 * Health of one integration source (#318). Persisted per source in `integration-health-store`.
 * Local has no entry: it has no upstream that can fail.
 */
export interface SourceHealth {
  status: IntegrationHealth;
  /** Reason of the last failure; `null` while healthy or unconfigured. */
  lastError: string | null;
  /** Epoch ms of the last sync that was merged into the board; `null` until the first one. */
  lastSuccessfulSync: number | null;
}

export type SourceHealthMap = Record<IntegrationSourceId, SourceHealth>;
