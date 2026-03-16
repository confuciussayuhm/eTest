/**
 * AI Layer Type Definitions
 *
 * Shared types for Claude API message handling, execution context,
 * and structured message formats.
 */

export interface ExecutionContext {
  isParallelExecution: boolean;
  useCleanOutput: boolean;
}

export interface AssistantResult {
  result: string;
  cost: number;
  duration: number;
  turns: number;
  model?: string;
}

export interface ResultData {
  result: string;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  session_id: string;
  model?: string;
  total_cost_usd?: number;
}

export interface ToolUseData {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolResultData {
  tool_name: string;
  tool_result: string;
  is_error: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AssistantMessage {
  type: 'assistant';
  message: string;
  content?: ContentBlock[];
}

export interface ResultMessage {
  type: 'result';
  data: ResultData;
  subtype: string;
}

export interface ToolUseMessage {
  type: 'tool_use';
  data: ToolUseData;
}

export interface ToolResultMessage {
  type: 'tool_result';
  data: ToolResultData;
}

export interface ApiErrorDetection {
  isBillingError: boolean;
  isSessionLimit: boolean;
  isApiError: boolean;
  errorMessage: string;
}

export interface SystemInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model?: string;
}

export interface UserMessage {
  type: 'user';
  message: string;
}
