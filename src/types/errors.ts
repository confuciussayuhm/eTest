/**
 * Error type definitions for UAT framework
 */

export enum ErrorCode {
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_VALIDATION_FAILED = 'CONFIG_VALIDATION_FAILED',
  CONFIG_PARSE_ERROR = 'CONFIG_PARSE_ERROR',
  AGENT_EXECUTION_FAILED = 'AGENT_EXECUTION_FAILED',
  OUTPUT_VALIDATION_FAILED = 'OUTPUT_VALIDATION_FAILED',
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  SPENDING_CAP_REACHED = 'SPENDING_CAP_REACHED',
  INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS',
  GIT_CHECKPOINT_FAILED = 'GIT_CHECKPOINT_FAILED',
  GIT_ROLLBACK_FAILED = 'GIT_ROLLBACK_FAILED',
  PROMPT_LOAD_FAILED = 'PROMPT_LOAD_FAILED',
  DELIVERABLE_NOT_FOUND = 'DELIVERABLE_NOT_FOUND',
  TARGET_NOT_FOUND = 'TARGET_NOT_FOUND',
  AUTH_FAILED = 'AUTH_FAILED',
  BILLING_ERROR = 'BILLING_ERROR',
}

export type UATErrorType =
  | 'config'
  | 'network'
  | 'tool'
  | 'prompt'
  | 'filesystem'
  | 'validation'
  | 'billing'
  | 'unknown';

export interface UATErrorContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  context: string;
  error: {
    name: string;
    message: string;
    type: UATErrorType;
    retryable: boolean;
    stack?: string;
  };
}

export interface ToolErrorResult {
  tool: string;
  output: string;
  status: 'error';
  duration: number;
  success: false;
  error: Error;
}

export interface PromptErrorResult {
  success: false;
  error: Error;
}
