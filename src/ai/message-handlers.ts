/**
 * Message Handlers
 *
 * Handles dispatching and processing of Claude API streaming messages
 * during agent execution, including error detection and structured error handling.
 */

import { UATError } from '../services/error-handling.js';
import { ErrorCode } from '../types/errors.js';
import {
  matchesBillingApiPattern,
  matchesBillingTextPattern,
} from '../utils/billing-detection.js';
import type {
  ApiErrorDetection,
  AssistantMessage,
  ResultMessage,
  ToolUseMessage,
  ToolResultMessage,
  ExecutionContext,
} from './types.js';
import type { ProgressManager } from './progress-manager.js';
import type { AuditLogger } from './audit-logger.js';

/**
 * Detect API errors from error messages, including billing, session limit,
 * and generic API errors.
 */
export function detectApiError(errorMessage: string): ApiErrorDetection {
  const lowerMessage = errorMessage.toLowerCase();

  const isBillingError =
    matchesBillingApiPattern(lowerMessage) ||
    matchesBillingTextPattern(lowerMessage);

  const isSessionLimit =
    lowerMessage.includes('session limit') ||
    lowerMessage.includes('conversation too long') ||
    lowerMessage.includes('context window');

  const isApiError =
    lowerMessage.includes('api error') ||
    lowerMessage.includes('internal server error') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('bad gateway') ||
    /\b5\d{2}\b/.test(lowerMessage);

  return {
    isBillingError,
    isSessionLimit,
    isApiError,
    errorMessage,
  };
}

/**
 * Handle a detected API error by throwing an appropriate UATError.
 */
export function handleStructuredError(detection: ApiErrorDetection): never {
  if (detection.isBillingError) {
    throw new UATError(
      `Billing error: ${detection.errorMessage}`,
      'billing',
      true,
      { originalError: detection.errorMessage },
      ErrorCode.BILLING_ERROR
    );
  }

  if (detection.isSessionLimit) {
    throw new UATError(
      `Session limit reached: ${detection.errorMessage}`,
      'network',
      true,
      { originalError: detection.errorMessage },
      ErrorCode.API_RATE_LIMITED
    );
  }

  if (detection.isApiError) {
    throw new UATError(
      `API error: ${detection.errorMessage}`,
      'network',
      true,
      { originalError: detection.errorMessage },
      ErrorCode.AGENT_EXECUTION_FAILED
    );
  }

  throw new UATError(
    `Unknown API error: ${detection.errorMessage}`,
    'unknown',
    true,
    { originalError: detection.errorMessage },
    ErrorCode.AGENT_EXECUTION_FAILED
  );
}

/**
 * Handle an assistant message from the stream.
 */
export function handleAssistantMessage(
  message: AssistantMessage,
  turn: number,
  auditLogger: AuditLogger,
  progressManager: ProgressManager
): void {
  if (message.message && message.message.trim().length > 0) {
    progressManager.updateMessage(message.message.trim().slice(0, 80));
    void auditLogger.logLlmResponse(turn, message.message);
  }
}

/**
 * Handle a result message from the stream.
 */
export function handleResultMessage(
  message: ResultMessage,
  auditLogger: AuditLogger
): void {
  const data = message.data;
  if (data.is_error) {
    const detection = detectApiError(data.result);
    if (detection.isBillingError || detection.isSessionLimit || detection.isApiError) {
      void auditLogger.logEvent('api_error', {
        error: data.result,
        isBilling: detection.isBillingError,
        isSessionLimit: detection.isSessionLimit,
      });
    }
  }
}

/**
 * Handle a tool use message from the stream.
 */
export function handleToolUseMessage(
  message: ToolUseMessage,
  auditLogger: AuditLogger,
  progressManager: ProgressManager
): void {
  const toolName = message.data.tool_name;
  progressManager.updateTool(toolName);
  void auditLogger.logToolStart(toolName, message.data.tool_input);
}

/**
 * Handle a tool result message from the stream.
 */
export function handleToolResultMessage(
  message: ToolResultMessage,
  auditLogger: AuditLogger
): void {
  void auditLogger.logToolEnd(
    message.data.tool_name,
    message.data.tool_result,
    message.data.is_error,
    0
  );
}

/** Actions that can be dispatched for a message. */
export type MessageDispatchAction =
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'result'; message: ResultMessage }
  | { type: 'tool_use'; message: ToolUseMessage }
  | { type: 'tool_result'; message: ToolResultMessage }
  | { type: 'unknown'; raw: unknown };

/** Dependencies for message dispatch. */
export interface MessageDispatchDeps {
  auditLogger: AuditLogger;
  progressManager: ProgressManager;
  context: ExecutionContext;
  description: string;
  turn: number;
  onOutput?: (line: string) => void;
}

/**
 * Dispatch a parsed message to the appropriate handler.
 */
export function dispatchMessage(
  action: MessageDispatchAction,
  deps: MessageDispatchDeps
): void {
  switch (action.type) {
    case 'assistant':
      handleAssistantMessage(
        action.message,
        deps.turn,
        deps.auditLogger,
        deps.progressManager
      );
      break;

    case 'result':
      handleResultMessage(action.message, deps.auditLogger);
      break;

    case 'tool_use':
      handleToolUseMessage(
        action.message,
        deps.auditLogger,
        deps.progressManager
      );
      break;

    case 'tool_result':
      handleToolResultMessage(action.message, deps.auditLogger);
      break;

    case 'unknown':
      // Silently ignore unrecognized message types
      break;
  }
}
