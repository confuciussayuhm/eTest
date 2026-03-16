import type { ErrorResponse } from '../types/tool-responses.js';

export function createValidationError(message: string, retryable: boolean, context?: Record<string, unknown>): ErrorResponse {
  return { status: 'error', message, retryable, ...(context && { context }) };
}

export function createGenericError(error: unknown, retryable: boolean, context?: Record<string, unknown>): ErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { status: 'error', message, retryable, ...(context && { context }) };
}
