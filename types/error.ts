/**
 * Interface for API error responses
 */
export interface ApiError extends Error {
  /** HTTP status code */
  status?: number;
  /** Error message */
  message: string;
  /** Additional error details */
  details?: unknown;
}
