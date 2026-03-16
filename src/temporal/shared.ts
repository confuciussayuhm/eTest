/**
 * Shared types and utilities for the Temporal layer.
 *
 * Adapted from Shannon's Temporal patterns for UAT (black-box testing against a URL).
 * Key difference: PipelineInput uses webUrl instead of repoPath.
 */

import type { TestCategory } from '../types/agents.js';
import type { AgentMetrics } from '../types/metrics.js';

// ---------------------------------------------------------------------------
// Pipeline input
// ---------------------------------------------------------------------------

export interface PipelineInput {
  /** The target web application URL (required, replaces repoPath). */
  webUrl: string;

  /** Optional path to a YAML/JSON config file. */
  configPath?: string | undefined;

  /** Directory where audit-logs and deliverables are written. */
  outputPath?: string | undefined;

  /** When true, agents run with reduced budgets for faster iteration. */
  pipelineTestingMode?: boolean | undefined;

  /** Override pipeline-level settings (concurrency, retry preset, etc.). */
  pipelineConfig?: PipelineConfigOverrides | undefined;

  /** Temporal workflow ID (set by the client). */
  workflowId?: string | undefined;

  /** Unique session identifier for audit logs. */
  sessionId?: string | undefined;

  /** If set, the workflow resumes from this workspace directory. */
  resumeFromWorkspace?: string | undefined;

  /** List of previous workflow IDs that were terminated before this resume. */
  terminatedWorkflows?: string[] | undefined;

  /** Selective test categories to run (e.g. ['auth', 'forms']). Omit to run all. */
  tests?: TestCategory[] | undefined;

  /** When true, loads regression baselines and compares results. */
  regressionMode?: boolean | undefined;
}

export interface PipelineConfigOverrides {
  maxConcurrentPipelines?: number | undefined;
  retryPreset?: string | undefined;
}

// ---------------------------------------------------------------------------
// Resume state
// ---------------------------------------------------------------------------

export interface ResumeState {
  workspaceName: string;
  originalUrl: string;
  completedAgents: string[];
  checkpointHash: string;
  originalWorkflowId: string;
}

// ---------------------------------------------------------------------------
// Pipeline summary & state
// ---------------------------------------------------------------------------

export interface PipelineSummary {
  status: 'completed' | 'failed';
  totalDurationMs: number;
  totalCostUsd: number;
  completedAgents: string[];
  failedAgents: string[];
  agentMetrics: Record<string, AgentMetrics>;
  error?: string | undefined;
}

export type PipelinePhase =
  | 'preflight'
  | 'discovery'
  | 'scenario-planning'
  | 'test-plan-exec'
  | 'multi-persona'
  | 'reporting'
  | 'completed'
  | 'failed';

export interface PipelineState {
  phase: PipelinePhase;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgents: string[];
  totalCostUsd: number;
  startedAt: number;
  error?: string | undefined;
}

export interface PipelineProgress extends PipelineState {
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

// ---------------------------------------------------------------------------
// Plan+Exec pipeline result (replaces VulnExploitPipelineResult)
// ---------------------------------------------------------------------------

export interface PlanExecPipelineResult {
  testCategory: TestCategory;
  planMetrics: AgentMetrics | null;
  execMetrics: AgentMetrics | null;
  execDecision: { shouldExecute: boolean; testCaseCount: number } | null;
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Progress query
// ---------------------------------------------------------------------------

export function getProgress(state: PipelineState): PipelineProgress {
  const now = Date.now();
  const elapsedMs = now - state.startedAt;

  // Rough estimate: 31 agents total, each ~equal weight
  const totalAgents = 31;
  const doneCount = state.completedAgents.length + state.failedAgents.length;
  const estimatedRemainingMs =
    doneCount > 0
      ? Math.round((elapsedMs / doneCount) * (totalAgents - doneCount))
      : null;

  return {
    ...state,
    elapsedMs,
    estimatedRemainingMs,
  };
}
