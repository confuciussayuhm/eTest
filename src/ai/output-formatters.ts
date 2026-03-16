/**
 * Output Formatters
 *
 * Formatting utilities for agent output during execution,
 * including agent-specific prefixes and browser action formatting.
 */

import { AGENTS } from '../session-manager.js';
import type {
  ExecutionContext,
  AssistantMessage,
  ResultMessage,
  ToolUseMessage,
  ToolResultMessage,
} from './types.js';

/** Map of agent name substrings to display prefixes. */
const AGENT_PREFIX_MAP: ReadonlyArray<[string, string]> = [
  ['navigation', '[Navigation]'],
  ['forms', '[Forms]'],
  ['auth-', '[Auth]'],
  ['authz', '[Authz]'],
  ['data', '[Data]'],
  ['uiux', '[UI/UX]'],
  ['api', '[API]'],
  ['crossbrowser', '[CrossBrowser]'],
  ['a11y', '[A11y]'],
  ['performance', '[Performance]'],
  ['errors', '[Errors]'],
  ['e2e', '[E2E]'],
  ['discovery', '[Discovery]'],
  ['scenario', '[Scenario]'],
  ['report', '[Report]'],
  ['multi-persona', '[MultiPersona]'],
];

/**
 * Get a display prefix for the given agent description.
 * Checks registered AGENTS first, then falls back to description matching.
 */
export function getAgentPrefix(description: string): string {
  // Try matching against registered agent names
  const lowerDesc = description.toLowerCase();
  for (const agentName of Object.keys(AGENTS)) {
    if (lowerDesc.includes(agentName)) {
      for (const [pattern, prefix] of AGENT_PREFIX_MAP) {
        if (agentName.includes(pattern)) {
          return prefix;
        }
      }
    }
  }

  // Fall back to description matching
  for (const [pattern, prefix] of AGENT_PREFIX_MAP) {
    if (lowerDesc.includes(pattern)) {
      return prefix;
    }
  }

  return '[Agent]';
}

/**
 * Detect execution context from agent description.
 * Plan agents and exec agents running in parallel use clean output.
 */
export function detectExecutionContext(description: string): ExecutionContext {
  const lowerDesc = description.toLowerCase();
  const isParallelExecution =
    lowerDesc.includes('plan agent') || lowerDesc.includes('exec agent');
  return {
    isParallelExecution,
    useCleanOutput: isParallelExecution,
  };
}

/**
 * Format assistant text output with agent prefix.
 */
export function formatAssistantOutput(
  message: AssistantMessage,
  description: string,
  context: ExecutionContext
): string | null {
  if (!message.message || message.message.trim().length === 0) {
    return null;
  }
  const prefix = getAgentPrefix(description);
  if (context.useCleanOutput) {
    return `${prefix} ${message.message.trim()}`;
  }
  return `${prefix} ${message.message}`;
}

/**
 * Format result output showing cost and duration.
 */
export function formatResultOutput(
  message: ResultMessage,
  description: string,
  _context: ExecutionContext
): string {
  const prefix = getAgentPrefix(description);
  const data = message.data;
  const cost = data.cost_usd !== undefined ? `$${data.cost_usd.toFixed(4)}` : 'N/A';
  const duration = data.duration_ms !== undefined
    ? `${(data.duration_ms / 1000).toFixed(1)}s`
    : 'N/A';
  const turns = data.num_turns !== undefined ? `${data.num_turns} turns` : '';
  const model = data.model ? ` (${data.model})` : '';

  if (data.is_error) {
    return `${prefix} Error: ${data.result} [${cost}, ${duration}${model}]`;
  }

  return `${prefix} Completed: ${turns} [${cost}, ${duration}${model}]`;
}

/**
 * Format error output with agent prefix.
 */
export function formatErrorOutput(
  error: string,
  description: string
): string {
  const prefix = getAgentPrefix(description);
  return `${prefix} Error: ${error}`;
}

/**
 * Format a completion message for agent finish.
 */
export function formatCompletionMessage(
  description: string,
  success: boolean,
  durationMs?: number
): string {
  const prefix = getAgentPrefix(description);
  const duration = durationMs !== undefined
    ? ` in ${(durationMs / 1000).toFixed(1)}s`
    : '';
  return success
    ? `${prefix} Completed successfully${duration}`
    : `${prefix} Failed${duration}`;
}

/**
 * Format tool use output, with special handling for browser actions.
 */
export function formatToolUseOutput(
  message: ToolUseMessage,
  description: string,
  context: ExecutionContext
): string | null {
  const toolName = message.data.tool_name;
  const input = message.data.tool_input;

  // Browser action formatting for Playwright tool calls
  if (toolName === 'browser_action' || toolName.startsWith('playwright_')) {
    const action = (input.action as string) || toolName;
    const url = input.url as string | undefined;
    const selector = input.selector as string | undefined;
    const text = input.text as string | undefined;

    let detail = action;
    if (url) detail = `${action}: ${url}`;
    else if (selector && text) detail = `${action}: "${text}" on ${selector}`;
    else if (selector) detail = `${action}: ${selector}`;
    else if (text) detail = `${action}: "${text}"`;

    if (context.useCleanOutput) {
      return `  -> ${detail}`;
    }
    const prefix = getAgentPrefix(description);
    return `${prefix} Browser: ${detail}`;
  }

  // Skip verbose JSON tool calls in clean output
  if (context.useCleanOutput) {
    return null;
  }

  const prefix = getAgentPrefix(description);
  return `${prefix} Tool: ${toolName}`;
}

/**
 * Format tool result output.
 */
export function formatToolResultOutput(
  message: ToolResultMessage,
  description: string,
  context: ExecutionContext
): string | null {
  if (context.useCleanOutput) {
    // Only show errors in clean output mode
    if (message.data.is_error) {
      const prefix = getAgentPrefix(description);
      return `${prefix} Tool error (${message.data.tool_name}): ${message.data.tool_result.slice(0, 200)}`;
    }
    return null;
  }

  const prefix = getAgentPrefix(description);
  if (message.data.is_error) {
    return `${prefix} Tool error (${message.data.tool_name}): ${message.data.tool_result.slice(0, 200)}`;
  }
  return `${prefix} Tool result (${message.data.tool_name}): ${message.data.tool_result.slice(0, 100)}...`;
}

/**
 * Filter out JSON-heavy tool call output that would clutter the display.
 */
export function filterJsonToolCalls(toolName: string, input: Record<string, unknown>): boolean {
  // Always show browser/playwright actions
  if (toolName === 'browser_action' || toolName.startsWith('playwright_')) {
    return false;
  }

  // Filter out large JSON inputs (e.g., file writes, data submissions)
  const inputStr = JSON.stringify(input);
  return inputStr.length > 500;
}
