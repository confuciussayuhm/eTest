/**
 * UAT Error Handling
 */

import {
  ErrorCode,
  type UATErrorType,
  type UATErrorContext,
  type PromptErrorResult,
} from '../types/errors.js';
import {
  matchesBillingApiPattern,
  matchesBillingTextPattern,
} from '../utils/billing-detection.js';

export class UATError extends Error {
  override name = 'UATError' as const;
  type: UATErrorType;
  retryable: boolean;
  context: UATErrorContext;
  timestamp: string;
  code?: ErrorCode;

  constructor(
    message: string,
    type: UATErrorType,
    retryable: boolean = false,
    context: UATErrorContext = {},
    code?: ErrorCode
  ) {
    super(message);
    this.type = type;
    this.retryable = retryable;
    this.context = context;
    this.timestamp = new Date().toISOString();
    if (code !== undefined) {
      this.code = code;
    }
  }
}

export function handlePromptError(
  promptName: string,
  error: Error
): PromptErrorResult {
  return {
    success: false,
    error: new UATError(
      `Failed to load prompt '${promptName}': ${error.message}`,
      'prompt',
      false,
      { promptName, originalError: error.message }
    ),
  };
}

const RETRYABLE_PATTERNS = [
  'network', 'connection', 'timeout', 'econnreset', 'enotfound', 'econnrefused',
  'rate limit', '429', 'too many requests',
  'server error', '5xx', 'internal server error', 'service unavailable', 'bad gateway',
  'mcp server', 'model unavailable', 'service temporarily unavailable', 'api error', 'terminated',
  'max turns', 'maximum turns',
  'oauth token refresh failed',
  'session limit',
];

const NON_RETRYABLE_PATTERNS = [
  'authentication', 'invalid prompt', 'out of memory', 'permission denied', 'invalid api key',
];

export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  if (NON_RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return false;
  }
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

function classifyByErrorCode(
  code: ErrorCode,
  retryableFromError: boolean
): { type: string; retryable: boolean } {
  switch (code) {
    case ErrorCode.SPENDING_CAP_REACHED:
    case ErrorCode.INSUFFICIENT_CREDITS:
      return { type: 'BillingError', retryable: true };
    case ErrorCode.API_RATE_LIMITED:
      return { type: 'RateLimitError', retryable: true };
    case ErrorCode.CONFIG_NOT_FOUND:
    case ErrorCode.CONFIG_VALIDATION_FAILED:
    case ErrorCode.CONFIG_PARSE_ERROR:
      return { type: 'ConfigurationError', retryable: false };
    case ErrorCode.PROMPT_LOAD_FAILED:
      return { type: 'ConfigurationError', retryable: false };
    case ErrorCode.GIT_CHECKPOINT_FAILED:
    case ErrorCode.GIT_ROLLBACK_FAILED:
      return { type: 'GitError', retryable: false };
    case ErrorCode.OUTPUT_VALIDATION_FAILED:
    case ErrorCode.DELIVERABLE_NOT_FOUND:
      return { type: 'OutputValidationError', retryable: true };
    case ErrorCode.AGENT_EXECUTION_FAILED:
      return { type: 'AgentExecutionError', retryable: retryableFromError };
    case ErrorCode.TARGET_NOT_FOUND:
      return { type: 'ConfigurationError', retryable: false };
    case ErrorCode.AUTH_FAILED:
      return { type: 'AuthenticationError', retryable: false };
    case ErrorCode.BILLING_ERROR:
      return { type: 'BillingError', retryable: true };
    default:
      return { type: 'UnknownError', retryable: retryableFromError };
  }
}

export function classifyErrorForTemporal(error: unknown): { type: string; retryable: boolean } {
  if (error instanceof UATError && error.code !== undefined) {
    return classifyByErrorCode(error.code, error.retryable);
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (matchesBillingApiPattern(message) || matchesBillingTextPattern(message)) {
    return { type: 'BillingError', retryable: true };
  }

  if (message.includes('oauth token refresh failed')) {
    return { type: 'TransientError', retryable: true };
  }

  if (message.includes('authentication') || message.includes('api key') ||
      /\b401\b/.test(message) || message.includes('authentication_error')) {
    return { type: 'AuthenticationError', retryable: false };
  }

  if (message.includes('permission') || message.includes('forbidden') || /\b403\b/.test(message)) {
    return { type: 'PermissionError', retryable: false };
  }

  if (message.includes('failed output validation') || message.includes('output validation failed')) {
    return { type: 'OutputValidationError', retryable: true };
  }

  if (message.includes('invalid_request_error') || message.includes('malformed') ||
      message.includes('validation')) {
    return { type: 'InvalidRequestError', retryable: false };
  }

  if (message.includes('request_too_large') || message.includes('too large') || /\b413\b/.test(message)) {
    return { type: 'RequestTooLargeError', retryable: false };
  }

  if (message.includes('enoent') || message.includes('no such file') ||
      message.includes('cli not installed')) {
    return { type: 'ConfigurationError', retryable: false };
  }

  if (message.includes('max turns') || message.includes('budget') ||
      message.includes('execution limit') || message.includes('error_max_turns') ||
      message.includes('error_max_budget')) {
    return { type: 'ExecutionLimitError', retryable: false };
  }

  if (message.includes('invalid url') || message.includes('invalid target') ||
      message.includes('malformed url') || message.includes('invalid uri')) {
    return { type: 'InvalidTargetError', retryable: false };
  }

  return { type: 'TransientError', retryable: true };
}
