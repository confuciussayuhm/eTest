/**
 * Maps a PipelineSummary to a WorkflowSummary for the audit subsystem.
 */

import type { PipelineSummary } from './shared.js';
import type { WorkflowSummary, AgentMetricsSummary } from '../audit/workflow-logger.js';

/**
 * Convert the Temporal-layer PipelineSummary into the audit-layer
 * WorkflowSummary so we can persist it via WorkflowLogger.
 */
export function toWorkflowSummary(summary: PipelineSummary): WorkflowSummary {
  const agentMetrics: Record<string, AgentMetricsSummary> = {};

  for (const [agentName, metrics] of Object.entries(summary.agentMetrics)) {
    agentMetrics[agentName] = {
      durationMs: metrics.durationMs,
      costUsd: metrics.costUsd,
    };
  }

  return {
    status: summary.status,
    totalDurationMs: summary.totalDurationMs,
    totalCostUsd: summary.totalCostUsd,
    completedAgents: summary.completedAgents,
    agentMetrics,
    ...(summary.error !== undefined && { error: summary.error }),
  };
}
