
/**
 * Task position metadata for efficient ordering
 */
export interface TaskPositionEntry {
  taskId: string;
  position: number;
  updatedAt: Date;
}

/**
 * Position gap used for drag-drop optimization
 * Allows inserting tasks between positions without reordering all tasks
 */
export const POSITION_GAP = 100;

/**
 * Helper to generate a position between two existing positions
 */
export function getPositionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) {
    return POSITION_GAP;
  }
  if (before === null && after !== null) {
    return after - POSITION_GAP;
  }
  if (after === null && before !== null) {
    return before + POSITION_GAP;
  }
  if (before !== null && after !== null) {
    return Math.floor((before + after) / 2);
  }
  return POSITION_GAP; // Fallback (should never reach here)
}

/**
 * Check if positions need rebalancing (gaps too small)
 */
export function needsRebalancing(positions: Record<string, number>): boolean {
  const sortedPositions = Object.values(positions).sort((a, b) => a - b);
  
  for (let i = 1; i < sortedPositions.length; i++) {
    const current = sortedPositions[i];
    const previous = sortedPositions[i - 1];
    if (current !== undefined && previous !== undefined) {
      const gap = current - previous;
      if (gap < 10) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Rebalance positions to restore gaps
 */
export function rebalancePositions(taskIds: string[]): Record<string, number> {
  const positions: Record<string, number> = {};
  taskIds.forEach((taskId, index) => {
    positions[taskId] = index * POSITION_GAP;
  });
  return positions;
}
