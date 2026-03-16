/**
 * Tool Response Type Definitions
 *
 * Defines structured response formats for MCP tools to ensure
 * consistent error handling and success reporting.
 */

export interface ToolResult {
  type: 'text';
  text: string;
}

export interface SaveDeliverableResponse {
  status: 'success' | 'error';
  message: string;
  filepath?: string;
  deliverableType?: string;
  validated?: boolean;
}

export interface SuccessResponse {
  status: 'success';
  message: string;
  [key: string]: unknown;
}

export interface ErrorResponse {
  status: 'error';
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export function createToolResult(response: SaveDeliverableResponse | SuccessResponse | ErrorResponse): ToolResult {
  return { type: 'text', text: JSON.stringify(response) };
}
