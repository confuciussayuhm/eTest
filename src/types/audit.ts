/**
 * Audit system type definitions
 */
export interface SessionMetadata {
  id: string;
  webUrl: string;
  outputPath?: string;
  [key: string]: unknown;
}

export interface AgentEndResult {
  attemptNumber: number;
  duration_ms: number;
  cost_usd: number;
  success: boolean;
  model?: string | undefined;
  error?: string | undefined;
  checkpoint?: string | undefined;
  isFinalAttempt?: boolean | undefined;
}
