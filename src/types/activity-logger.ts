/**
 * Logger interface for services called from Temporal activities.
 */
export interface ActivityLogger {
  info(message: string, attrs?: Record<string, unknown>): void;
  warn(message: string, attrs?: Record<string, unknown>): void;
  error(message: string, attrs?: Record<string, unknown>): void;
}
