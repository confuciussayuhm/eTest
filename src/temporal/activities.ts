/**
 * Temporal Activity implementations for the Testicles UAT pipeline.
 *
 * Each exported function is registered with the Temporal worker and called
 * by the workflow via proxyActivities.
 */

import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

import type { AgentName, TestCategory } from '../types/agents.js';
import type { AgentMetrics } from '../types/metrics.js';
import type { SessionMetadata } from '../types/audit.js';
import type { PipelineSummary, ResumeState } from './shared.js';

import { classifyErrorForTemporal } from '../services/error-handling.js';
import { getOrCreateContainer, removeContainer } from '../services/container.js';
import { AuditSession } from '../audit/index.js';
import { assembleFinalReport, injectModelIntoReport } from '../services/reporting.js';
import { runPreflightChecks } from '../services/preflight.js';
import { isErr } from '../types/result.js';
import { toWorkflowSummary } from './summary-mapper.js';
import { createActivityLogger } from './activity-logger.js';

// ---------------------------------------------------------------------------
// Activity input (threaded through every activity call)
// ---------------------------------------------------------------------------

export interface ActivityInput {
  webUrl: string;
  workflowId: string;
  sessionId: string;
  configPath?: string | undefined;
  outputPath?: string | undefined;
  pipelineTestingMode?: boolean | undefined;
  regressionMode?: boolean | undefined;
  tests?: TestCategory[] | undefined;
}

// ---------------------------------------------------------------------------
// Session metadata builder (no repoPath -- UAT is black-box)
// ---------------------------------------------------------------------------

function buildSessionMetadata(input: ActivityInput): SessionMetadata {
  return {
    id: input.sessionId,
    webUrl: input.webUrl,
    ...(input.outputPath !== undefined && { outputPath: input.outputPath }),
  };
}

// ---------------------------------------------------------------------------
// Core agent execution loop (heartbeat + container lifecycle + error class.)
// ---------------------------------------------------------------------------

async function runAgentActivity(
  input: ActivityInput,
  agentName: string,
): Promise<AgentMetrics> {
  const logger = createActivityLogger(agentName);
  const ctx = Context.current();

  logger.info(`Starting agent: ${agentName}`, { webUrl: input.webUrl });

  const sessionMetadata = buildSessionMetadata(input);
  const container = getOrCreateContainer(input.workflowId, sessionMetadata);
  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize(input.workflowId);

  // Heartbeat loop -- keeps Temporal informed the activity is alive (2s interval)
  const heartbeatInterval = setInterval(() => {
    try {
      ctx.heartbeat(`${agentName} running`);
    } catch {
      // Activity may have been cancelled
    }
  }, 2000);

  try {
    const result = await container.agentExecution.executeOrThrow(
      agentName as AgentName,
      {
        webUrl: input.webUrl,
        configPath: input.configPath,
        pipelineTestingMode: input.pipelineTestingMode,
        attemptNumber: ctx.info.attempt,
      },
      auditSession,
      logger,
    );

    return {
      durationMs: result.duration_ms,
      inputTokens: null,
      outputTokens: null,
      costUsd: result.cost_usd,
      numTurns: null,
      model: result.model,
    };
  } catch (err) {
    const { type, retryable } = classifyErrorForTemporal(err);
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Agent ${agentName} failed: ${message}`, { type, retryable });

    throw ApplicationFailure.create({
      message,
      type,
      nonRetryable: !retryable,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// ---------------------------------------------------------------------------
// Per-agent exports: Discovery & Scenario Planning
// ---------------------------------------------------------------------------

export async function runDiscoveryAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'discovery');
}

export async function runScenarioPlanningAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'scenario-planning');
}

// ---------------------------------------------------------------------------
// Per-agent exports: 12 Plan agents
// ---------------------------------------------------------------------------

export async function runNavigationPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'navigation-plan');
}

export async function runFormsPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'forms-plan');
}

export async function runAuthPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'auth-plan');
}

export async function runAuthzPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'authz-plan');
}

export async function runDataPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'data-plan');
}

export async function runUiuxPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'uiux-plan');
}

export async function runApiPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'api-plan');
}

export async function runCrossbrowserPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'crossbrowser-plan');
}

export async function runA11yPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'a11y-plan');
}

export async function runPerformancePlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'performance-plan');
}

export async function runErrorsPlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'errors-plan');
}

export async function runE2ePlanAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'e2e-plan');
}

// ---------------------------------------------------------------------------
// Per-agent exports: 12 Exec agents
// ---------------------------------------------------------------------------

export async function runNavigationExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'navigation-exec');
}

export async function runFormsExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'forms-exec');
}

export async function runAuthExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'auth-exec');
}

export async function runAuthzExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'authz-exec');
}

export async function runDataExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'data-exec');
}

export async function runUiuxExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'uiux-exec');
}

export async function runApiExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'api-exec');
}

export async function runCrossbrowserExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'crossbrowser-exec');
}

export async function runA11yExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'a11y-exec');
}

export async function runPerformanceExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'performance-exec');
}

export async function runErrorsExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'errors-exec');
}

export async function runE2eExecAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'e2e-exec');
}

// ---------------------------------------------------------------------------
// Per-agent exports: 4 Multi-persona agents
// ---------------------------------------------------------------------------

export async function runMultiPersonaSetupAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'multi-persona-setup');
}

export async function runMultiPersonaRecordAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'multi-persona-record');
}

export async function runMultiPersonaReplayAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'multi-persona-replay');
}

export async function runMultiPersonaAnalysisAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'multi-persona-analysis');
}

// ---------------------------------------------------------------------------
// Report agent
// ---------------------------------------------------------------------------

export async function runReportAgent(input: ActivityInput): Promise<AgentMetrics> {
  return runAgentActivity(input, 'report');
}

// ---------------------------------------------------------------------------
// Test readiness check (replaces checkExploitationQueue)
// ---------------------------------------------------------------------------

export async function checkTestReadiness(
  input: ActivityInput,
  testCategory: TestCategory,
): Promise<{ shouldExecute: boolean; testCaseCount: number }> {
  const logger = createActivityLogger('check-test-readiness');
  const sourceDir = process.cwd();

  const sessionMetadata = buildSessionMetadata(input);
  const container = getOrCreateContainer(input.workflowId, sessionMetadata);

  const decision = await container.testReadinessChecker.checkQueue(
    testCategory,
    sourceDir,
    logger,
  );

  return {
    shouldExecute: decision.shouldExecute,
    testCaseCount: decision.testCaseCount,
  };
}

// ---------------------------------------------------------------------------
// Preflight validation (no repoPath check -- UAT is black-box)
// ---------------------------------------------------------------------------

export async function runPreflightValidation(input: ActivityInput): Promise<void> {
  const logger = createActivityLogger('preflight');
  logger.info('Running preflight validation');

  const result = await runPreflightChecks(input.configPath, logger);
  if (isErr(result)) {
    const { type, retryable } = classifyErrorForTemporal(result.error);
    throw ApplicationFailure.create({
      message: result.error.message,
      type,
      nonRetryable: !retryable,
    });
  }

  logger.info('Preflight validation passed');
}

// ---------------------------------------------------------------------------
// Report assembly & metadata injection
// ---------------------------------------------------------------------------

export async function assembleReportActivity(_input: ActivityInput): Promise<void> {
  const logger = createActivityLogger('assembleReport');
  const sourceDir = process.cwd();
  await assembleFinalReport(sourceDir, logger);
}

export async function injectReportMetadataActivity(input: ActivityInput): Promise<void> {
  const logger = createActivityLogger('injectReportMetadata');
  const sourceDir = process.cwd();
  const outputPath = input.outputPath ?? sourceDir;
  await injectModelIntoReport(sourceDir, outputPath, logger);
}

// ---------------------------------------------------------------------------
// Resume support
// ---------------------------------------------------------------------------

export async function loadResumeState(
  workspaceName: string,
  webUrl: string,
): Promise<ResumeState> {
  const logger = createActivityLogger('loadResumeState');
  logger.info(`Loading resume state from workspace: ${workspaceName}`);

  const { fs, path } = await import('zx');
  const stateFile = path.join(workspaceName, '.testicles-state.json');

  if (!await fs.pathExists(stateFile)) {
    throw ApplicationFailure.nonRetryable(
      `Resume state file not found: ${stateFile}`,
    );
  }

  const raw = await fs.readJson(stateFile);
  const state: ResumeState = {
    workspaceName,
    originalUrl: raw.webUrl ?? webUrl,
    completedAgents: raw.completedAgents ?? [],
    checkpointHash: raw.checkpointHash ?? '',
    originalWorkflowId: raw.workflowId ?? '',
  };

  logger.info(`Loaded resume state: ${state.completedAgents.length} completed agents`);
  return state;
}

export async function recordResumeAttempt(
  input: ActivityInput,
  terminatedWorkflows: string[],
  checkpointHash: string,
  _originalWorkflowId: string,
  completedAgents: string[],
): Promise<void> {
  const logger = createActivityLogger('recordResumeAttempt');
  logger.info(`Recording resume attempt. Terminated workflows: ${terminatedWorkflows.join(', ')}`);

  const sessionMetadata = buildSessionMetadata(input);
  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize(input.workflowId);
  await auditSession.addResumeAttempt(input.workflowId, terminatedWorkflows, checkpointHash);

  // Log the resume header for the workflow log
  if (terminatedWorkflows.length > 0) {
    const previousWorkflowId = terminatedWorkflows[terminatedWorkflows.length - 1] ?? 'unknown';
    await auditSession.logResumeHeader({
      previousWorkflowId,
      newWorkflowId: input.workflowId,
      checkpointHash,
      completedAgents,
    });
  }
}

// ---------------------------------------------------------------------------
// Phase transition & workflow completion logging
// ---------------------------------------------------------------------------

export async function logPhaseTransition(
  input: ActivityInput,
  phase: string,
  event: 'start' | 'complete',
): Promise<void> {
  const logger = createActivityLogger('logPhaseTransition');
  logger.info(`Phase ${event}: ${phase}`);

  const sessionMetadata = buildSessionMetadata(input);
  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize(input.workflowId);

  if (event === 'start') {
    await auditSession.logPhaseStart(phase);
  } else {
    await auditSession.logPhaseComplete(phase);
  }
}

export async function logWorkflowComplete(
  input: ActivityInput,
  summary: PipelineSummary,
): Promise<void> {
  const logger = createActivityLogger('logWorkflowComplete');
  logger.info(`Workflow complete: ${summary.status}`, {
    completedAgents: summary.completedAgents.length,
    totalCostUsd: summary.totalCostUsd,
  });

  const sessionMetadata = buildSessionMetadata(input);
  const auditSession = new AuditSession(sessionMetadata);
  await auditSession.initialize(input.workflowId);

  const workflowSummary = toWorkflowSummary(summary);
  await auditSession.logWorkflowComplete(workflowSummary);

  const status = summary.status === 'completed' ? 'completed' : 'failed';
  await auditSession.updateSessionStatus(status);

  // Clean up the container for this workflow
  removeContainer(input.workflowId);
}
