/**
 * Temporal Workflow Definitions for the Testicles UAT pipeline.
 *
 * Adapted from Shannon's pentestPipelineWorkflow.  Key structural change:
 *   - 12 plan+exec pipelines (not vuln+exploit)
 *   - Multi-persona pipeline runs concurrently with plan+exec phase
 *   - webUrl replaces repoPath everywhere
 *
 * Phases:
 *   1. Preflight validation
 *   2. Discovery (sequential)
 *   3. Scenario Planning (sequential)
 *   4. Test Plan+Exec Pipelines (parallel, concurrency-limited) +
 *      Multi-Persona Pipeline (concurrent)
 *   5. Reporting (sequential)
 */

import {
  log,
  proxyActivities,
  defineQuery,
  setHandler,
  ApplicationFailure,
  workflowInfo,
} from '@temporalio/workflow';

import type * as activities from './activities.js';
import type { ActivityInput } from './activities.js';

import {
  type PipelineInput,
  type PipelineState,
  type PipelineProgress,
  type PlanExecPipelineResult,
  type PipelineSummary,
} from './shared.js';
import { getProgress } from './shared.js';

import type { TestCategory } from '../types/agents.js';
import type { AgentMetrics } from '../types/metrics.js';
import { formatWorkflowError } from './workflow-errors.js';

// ---------------------------------------------------------------------------
// Retry profiles (same 4 as Shannon)
// ---------------------------------------------------------------------------

const PRODUCTION_RETRY = {
  startToCloseTimeout: '45m',
  heartbeatTimeout: '5m',
  retry: {
    maximumAttempts: 4,
    initialInterval: '30s',
    backoffCoefficient: 2,
    maximumInterval: '5m',
  },
} as const;

const TESTING_RETRY = {
  startToCloseTimeout: '10m',
  heartbeatTimeout: '3m',
  retry: {
    maximumAttempts: 2,
    initialInterval: '10s',
    backoffCoefficient: 1.5,
    maximumInterval: '1m',
  },
} as const;

const SUBSCRIPTION_RETRY = {
  startToCloseTimeout: '60m',
  heartbeatTimeout: '5m',
  retry: {
    maximumAttempts: 6,
    initialInterval: '1m',
    backoffCoefficient: 2,
    maximumInterval: '10m',
  },
} as const;

const PREFLIGHT_RETRY = {
  startToCloseTimeout: '2m',
  heartbeatTimeout: '30s',
  retry: {
    maximumAttempts: 2,
    initialInterval: '5s',
    backoffCoefficient: 1,
    maximumInterval: '10s',
  },
} as const;

// ---------------------------------------------------------------------------
// Activity proxies
// ---------------------------------------------------------------------------

const acts = proxyActivities<typeof activities>(PRODUCTION_RETRY);
const testActs = proxyActivities<typeof activities>(TESTING_RETRY);
const subscriptionActs = proxyActivities<typeof activities>(SUBSCRIPTION_RETRY);
const preflightActs = proxyActivities<typeof activities>(PREFLIGHT_RETRY);

// ---------------------------------------------------------------------------
// Pipeline config: the 12 plan+exec entries
// ---------------------------------------------------------------------------

interface PipelineEntry {
  testCategory: TestCategory;
  planAgent: (input: ActivityInput) => Promise<AgentMetrics>;
  execAgent: (input: ActivityInput) => Promise<AgentMetrics>;
  runPlan: boolean;
  runExec: boolean;
}

function buildPipelineConfigs(
  a: typeof acts,
  selectedTests?: TestCategory[],
): PipelineEntry[] {
  const all: PipelineEntry[] = [
    { testCategory: 'navigation', planAgent: a.runNavigationPlanAgent, execAgent: a.runNavigationExecAgent, runPlan: true, runExec: true },
    { testCategory: 'forms', planAgent: a.runFormsPlanAgent, execAgent: a.runFormsExecAgent, runPlan: true, runExec: true },
    { testCategory: 'auth', planAgent: a.runAuthPlanAgent, execAgent: a.runAuthExecAgent, runPlan: true, runExec: true },
    { testCategory: 'authz', planAgent: a.runAuthzPlanAgent, execAgent: a.runAuthzExecAgent, runPlan: true, runExec: true },
    { testCategory: 'data', planAgent: a.runDataPlanAgent, execAgent: a.runDataExecAgent, runPlan: true, runExec: true },
    { testCategory: 'uiux', planAgent: a.runUiuxPlanAgent, execAgent: a.runUiuxExecAgent, runPlan: true, runExec: true },
    { testCategory: 'api', planAgent: a.runApiPlanAgent, execAgent: a.runApiExecAgent, runPlan: true, runExec: true },
    { testCategory: 'crossbrowser', planAgent: a.runCrossbrowserPlanAgent, execAgent: a.runCrossbrowserExecAgent, runPlan: true, runExec: true },
    { testCategory: 'a11y', planAgent: a.runA11yPlanAgent, execAgent: a.runA11yExecAgent, runPlan: true, runExec: true },
    { testCategory: 'performance', planAgent: a.runPerformancePlanAgent, execAgent: a.runPerformanceExecAgent, runPlan: true, runExec: true },
    { testCategory: 'errors', planAgent: a.runErrorsPlanAgent, execAgent: a.runErrorsExecAgent, runPlan: true, runExec: true },
    { testCategory: 'e2e', planAgent: a.runE2ePlanAgent, execAgent: a.runE2eExecAgent, runPlan: true, runExec: true },
  ];

  if (!selectedTests || selectedTests.length === 0) return all;
  return all.filter((e) => selectedTests.includes(e.testCategory));
}

// ---------------------------------------------------------------------------
// Concurrency limiter (same pattern as Shannon)
// ---------------------------------------------------------------------------

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
    });
    const wrapped = p.then(
      () => { executing.delete(wrapped); },
      () => { executing.delete(wrapped); },
    );
    executing.add(wrapped);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);
  return results;
}

// ---------------------------------------------------------------------------
// Plan+Exec pipeline runner
// ---------------------------------------------------------------------------

async function runPlanExecPipeline(
  entry: PipelineEntry,
  input: ActivityInput,
  a: typeof acts,
  state: PipelineState,
  agentMetrics: Record<string, AgentMetrics>,
  completedSet: Set<string>,
): Promise<PlanExecPipelineResult> {
  const planAgentName = `${entry.testCategory}-plan`;
  const execAgentName = `${entry.testCategory}-exec`;
  let planMetrics: AgentMetrics | null = null;
  let execMetrics: AgentMetrics | null = null;
  let execDecision: { shouldExecute: boolean; testCaseCount: number } | null = null;

  try {
    // Plan phase (skip if already completed via resume)
    if (entry.runPlan && !shouldSkip(planAgentName, completedSet)) {
      state.currentAgent = planAgentName;
      planMetrics = await entry.planAgent(input);
      state.completedAgents.push(planAgentName);
      agentMetrics[planAgentName] = planMetrics;
      if (planMetrics.costUsd) state.totalCostUsd += planMetrics.costUsd;
    }

    // Readiness check
    execDecision = await a.checkTestReadiness(input, entry.testCategory);

    // Conditional execution
    if (entry.runExec && execDecision.shouldExecute && !shouldSkip(execAgentName, completedSet)) {
      state.currentAgent = execAgentName;
      execMetrics = await entry.execAgent(input);
      state.completedAgents.push(execAgentName);
      agentMetrics[execAgentName] = execMetrics;
      if (execMetrics.costUsd) state.totalCostUsd += execMetrics.costUsd;
    }

    return { testCategory: entry.testCategory, planMetrics, execMetrics, execDecision };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Record partial failure
    if (!state.completedAgents.includes(planAgentName) && !state.failedAgents.includes(planAgentName)) {
      state.failedAgents.push(planAgentName);
    }
    if (!state.completedAgents.includes(execAgentName) && !state.failedAgents.includes(execAgentName)) {
      state.failedAgents.push(execAgentName);
    }

    return {
      testCategory: entry.testCategory,
      planMetrics,
      execMetrics,
      execDecision,
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Multi-persona pipeline runner (sequential: setup -> record -> replay -> analysis)
// ---------------------------------------------------------------------------

async function runMultiPersonaPipeline(
  input: ActivityInput,
  a: typeof acts,
  state: PipelineState,
  agentMetrics: Record<string, AgentMetrics>,
  completedSet: Set<string>,
): Promise<void> {
  const agents = [
    { name: 'multi-persona-setup' as const, fn: a.runMultiPersonaSetupAgent },
    { name: 'multi-persona-record' as const, fn: a.runMultiPersonaRecordAgent },
    { name: 'multi-persona-replay' as const, fn: a.runMultiPersonaReplayAgent },
    { name: 'multi-persona-analysis' as const, fn: a.runMultiPersonaAnalysisAgent },
  ];

  for (const agent of agents) {
    if (shouldSkip(agent.name, completedSet)) continue;

    state.currentAgent = agent.name;
    try {
      const metrics = await agent.fn(input);
      state.completedAgents.push(agent.name);
      agentMetrics[agent.name] = metrics;
      if (metrics.costUsd) state.totalCostUsd += metrics.costUsd;
    } catch (err) {
      state.failedAgents.push(agent.name);
      // Multi-persona failures are non-fatal to the overall pipeline
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Resume support
// ---------------------------------------------------------------------------

function shouldSkip(agentName: string, completedSet: Set<string>): boolean {
  return completedSet.has(agentName);
}

// ---------------------------------------------------------------------------
// Sequential phase helper
// ---------------------------------------------------------------------------

async function runSequentialPhase(
  phaseName: string,
  agentName: string,
  agentFn: (input: ActivityInput) => Promise<AgentMetrics>,
  input: ActivityInput,
  a: typeof acts,
  state: PipelineState,
  agentMetrics: Record<string, AgentMetrics>,
  completedSet: Set<string>,
): Promise<void> {
  await a.logPhaseTransition(input, phaseName, 'start');
  state.phase = phaseName as PipelineState['phase'];

  if (!shouldSkip(agentName, completedSet)) {
    state.currentAgent = agentName;
    const metrics = await agentFn(input);
    state.completedAgents.push(agentName);
    agentMetrics[agentName] = metrics;
    if (metrics.costUsd) state.totalCostUsd += metrics.costUsd;
  }

  await a.logPhaseTransition(input, phaseName, 'complete');
}

// ---------------------------------------------------------------------------
// Compute summary
// ---------------------------------------------------------------------------

function computeSummary(
  state: PipelineState,
  status: 'completed' | 'failed',
  agentMetrics: Record<string, AgentMetrics>,
): PipelineSummary {
  return {
    status,
    totalCostUsd: Object.values(agentMetrics).reduce((sum, m) => sum + (m.costUsd ?? 0), 0),
    totalDurationMs: Date.now() - state.startedAt,
    completedAgents: [...state.completedAgents],
    failedAgents: [...state.failedAgents],
    agentMetrics,
    ...(state.error && { error: state.error }),
  };
}

// ---------------------------------------------------------------------------
// Progress query
// ---------------------------------------------------------------------------

const getProgressQuery = defineQuery<PipelineProgress>('getProgress');

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function uatPipelineWorkflow(pipelineInput: PipelineInput): Promise<PipelineState> {
  const {
    webUrl,
    configPath,
    outputPath,
    pipelineTestingMode = false,
    workflowId = workflowInfo().workflowId,
    sessionId = workflowInfo().workflowId,
    resumeFromWorkspace,
    terminatedWorkflows,
    tests: selectedTests,
    regressionMode = false,
    pipelineConfig,
  } = pipelineInput;

  // Select activity proxy based on testing mode / config
  const retryPreset = pipelineConfig?.retryPreset ?? 'default';
  const a: typeof acts =
    pipelineTestingMode ? testActs :
    retryPreset === 'subscription' ? subscriptionActs :
    acts;

  const maxConcurrent = pipelineConfig?.maxConcurrentPipelines ?? 4;

  // Build the activity input that is threaded through every call
  const activityInput: ActivityInput = {
    webUrl,
    workflowId,
    sessionId,
    configPath,
    outputPath,
    pipelineTestingMode: pipelineTestingMode || undefined,
    regressionMode: regressionMode || undefined,
    tests: selectedTests,
  };

  // Pipeline state -- exposed via query
  const state: PipelineState = {
    phase: 'preflight',
    currentAgent: null,
    completedAgents: [],
    failedAgents: [],
    totalCostUsd: 0,
    startedAt: Date.now(),
  };

  // Agent metrics tracked separately (PipelineState doesn't include them)
  const agentMetrics: Record<string, AgentMetrics> = {};

  // Register query handler
  setHandler(getProgressQuery, () => getProgress(state));

  // Track agents completed in a previous run (resume support)
  const completedSet = new Set<string>();

  try {
    // ------------------------------------------------------------------
    // Phase 0: Preflight
    // ------------------------------------------------------------------
    log.info('Starting preflight validation');
    await preflightActs.runPreflightValidation(activityInput);

    // ------------------------------------------------------------------
    // Resume handling
    // ------------------------------------------------------------------
    if (resumeFromWorkspace) {
      const resumeState = await a.loadResumeState(resumeFromWorkspace, webUrl);
      for (const agent of resumeState.completedAgents) {
        completedSet.add(agent);
        state.completedAgents.push(agent);
      }
      if (terminatedWorkflows && terminatedWorkflows.length > 0) {
        await a.recordResumeAttempt(
          activityInput,
          terminatedWorkflows,
          resumeState.checkpointHash,
          resumeState.originalWorkflowId,
          resumeState.completedAgents,
        );
      }
    }

    // ------------------------------------------------------------------
    // Regression mode: skip discovery/planning, go straight to exec
    // ------------------------------------------------------------------
    if (!regressionMode) {
      // Phase 1: Discovery (sequential)
      await runSequentialPhase(
        'discovery', 'discovery', a.runDiscoveryAgent,
        activityInput, a, state, agentMetrics, completedSet,
      );

      // Phase 2: Scenario Planning (sequential)
      await runSequentialPhase(
        'scenario-planning', 'scenario-planning', a.runScenarioPlanningAgent,
        activityInput, a, state, agentMetrics, completedSet,
      );
    } else {
      log.info('Regression mode: skipping discovery and scenario planning');
    }

    // ------------------------------------------------------------------
    // Phase 3: Plan+Exec Pipelines (parallel) + Multi-Persona (concurrent)
    // ------------------------------------------------------------------
    await a.logPhaseTransition(activityInput, 'test-plan-exec', 'start');
    state.phase = 'test-plan-exec';

    const pipelines = buildPipelineConfigs(a, selectedTests);

    const pipelineTasks = pipelines.map(
      (entry) => () => runPlanExecPipeline(entry, activityInput, a, state, agentMetrics, completedSet),
    );

    // Run plan+exec pipelines and multi-persona concurrently
    await Promise.all([
      runWithConcurrencyLimit<PlanExecPipelineResult>(pipelineTasks, maxConcurrent),
      runMultiPersonaPipeline(activityInput, a, state, agentMetrics, completedSet),
    ]);

    await a.logPhaseTransition(activityInput, 'test-plan-exec', 'complete');

    // ------------------------------------------------------------------
    // Phase 4: Reporting (sequential)
    // ------------------------------------------------------------------
    await a.logPhaseTransition(activityInput, 'reporting', 'start');
    state.phase = 'reporting';

    // Assemble evidence before the report agent runs
    await a.assembleReportActivity(activityInput);

    if (!shouldSkip('report', completedSet)) {
      state.currentAgent = 'report';
      const reportMetrics = await a.runReportAgent(activityInput);
      state.completedAgents.push('report');
      agentMetrics['report'] = reportMetrics;
      if (reportMetrics.costUsd) state.totalCostUsd += reportMetrics.costUsd;
    }

    // Inject report metadata to output location
    await a.injectReportMetadataActivity(activityInput);

    await a.logPhaseTransition(activityInput, 'reporting', 'complete');

    // ------------------------------------------------------------------
    // Done
    // ------------------------------------------------------------------
    state.phase = 'completed';
    state.currentAgent = null;

    const summary = computeSummary(state, 'completed', agentMetrics);
    await a.logWorkflowComplete(activityInput, summary);

    log.info('Pipeline completed successfully', {
      completedAgents: state.completedAgents.length,
      totalCostUsd: summary.totalCostUsd,
    });

    return state;

  } catch (err) {
    state.phase = 'failed';
    const formatted = formatWorkflowError(err);
    state.error = formatted.message;

    log.error('Pipeline failed', {
      errorType: formatted.type,
      message: formatted.message,
      remediation: formatted.remediation,
      retryable: formatted.retryable,
    });

    const summary = computeSummary(state, 'failed', agentMetrics);

    try {
      await a.logWorkflowComplete(activityInput, summary);
    } catch {
      // Best-effort logging
    }

    if (err instanceof ApplicationFailure) throw err;
    throw ApplicationFailure.nonRetryable(formatted.message);
  }
}
