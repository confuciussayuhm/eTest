/**
 * Claude Executor
 *
 * Core execution engine for running Claude prompts with MCP server integration,
 * async message stream processing, output validation, and error handling.
 *
 * Adapted for the eTest UAT framework: black-box testing against URLs
 * (no repoPath), uses the eTest MCP helper server, and integrates with
 * the existing dispatchMessage side-effect API for logging/progress.
 */

import { fs, path } from 'zx';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { UATError } from '../services/error-handling.js';
import { isSpendingCapBehavior } from '../utils/billing-detection.js';
import { Timer } from '../utils/metrics.js';
import { resolveModel, type ModelTier } from './models.js';
import { getActualModelName } from './router-utils.js';
import { createProgressManager, type ProgressManager } from './progress-manager.js';
import { createAuditLogger, type AuditLogger } from './audit-logger.js';
import { detectExecutionContext, formatErrorOutput, formatCompletionMessage } from './output-formatters.js';
import {
  detectApiError,
  handleStructuredError,
  dispatchMessage,
  type MessageDispatchDeps,
} from './message-handlers.js';
import { AGENTS, AGENT_VALIDATORS, MCP_AGENT_MAPPING } from '../session-manager.js';
// @ts-ignore - resolved at runtime after mcp-server build
import { createETestHelperServer } from '../../mcp-server/dist/index.js'; // eslint-disable-line
import { AuditSession } from '../audit/index.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import type { AgentName } from '../types/agents.js';
import type {
  AssistantMessage,
  ResultMessage,
  ToolUseMessage,
  ToolResultMessage,
} from './types.js';

// ---------------------------------------------------------------------------
// Global env flag declarations (set externally by runner/container)
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var ETEST_DISABLE_LOADER: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ClaudePromptResult {
  success: boolean;
  result?: string | undefined;
  error?: string | undefined;
  cost?: number | undefined;
  duration: number;
  turns?: number | undefined;
  model?: string | undefined;
  retryable?: boolean | undefined;
  sessionId?: string | undefined;
}

interface MessageLoopResult {
  turnCount: number;
  result: string | null;
  apiErrorDetected: boolean;
  cost: number;
  model: string | undefined;
}

// ---------------------------------------------------------------------------
// MCP server construction
// ---------------------------------------------------------------------------

interface StdioMcpServer {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build MCP server configurations for an agent execution.
 * Returns a Record<string, McpServer> matching the Claude SDK's expected shape.
 */
function buildMcpServers(
  agentName: string,
  sourceDir: string
): Record<string, ReturnType<typeof createETestHelperServer> | StdioMcpServer> {
  const mcpServers: Record<string, ReturnType<typeof createETestHelperServer> | StdioMcpServer> = {};

  // eTest helper server is always present
  try {
    mcpServers['etest-helper'] = createETestHelperServer(sourceDir);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Warning: Failed to create etest-helper MCP server: ${errMsg}`);
  }

  // Playwright MCP server per agent (assigned via session-manager mapping)
  const agentDef = AGENTS[agentName as AgentName];
  if (agentDef) {
    const playwrightMcpName = MCP_AGENT_MAPPING[agentDef.promptTemplate] || null;
    if (playwrightMcpName) {
      const isDocker = process.env['ETEST_DOCKER'] === 'true';
      const userDataDir = `/tmp/${playwrightMcpName}`;

      const mcpArgs: string[] = [
        '@playwright/mcp@0.0.68',
        '--isolated',
        '--user-data-dir', userDataDir,
      ];

      if (isDocker) {
        mcpArgs.push('--executable-path', '/usr/bin/chromium-browser');
        mcpArgs.push('--browser', 'chromium');
      }

      const envVars: Record<string, string> = {
        PLAYWRIGHT_HEADLESS: 'true',
        ...(isDocker && { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }),
      };

      const MCP_ENV_ALLOWLIST = ['PATH', 'HOME', 'NODE_PATH', 'DISPLAY'] as const;
      for (const key of MCP_ENV_ALLOWLIST) {
        if (process.env[key]) envVars[key] = process.env[key]!;
      }

      mcpServers[playwrightMcpName] = {
        type: 'stdio' as const,
        command: 'npx',
        args: mcpArgs,
        env: envVars,
      };
    }
  }

  return mcpServers;
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

/**
 * Write an error log entry to disk for post-mortem analysis.
 */
export async function writeErrorLog(
  sourceDir: string,
  agentName: string,
  error: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  try {
    const logsDir = path.join(sourceDir, 'audit-logs', 'errors');
    await fs.ensureDir(logsDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${agentName}-${timestamp}.json`);
    const entry = {
      timestamp: new Date().toISOString(),
      agent: agentName,
      error,
      context,
      pipeline: 'etest-pipeline',
    };
    await fs.writeFile(logFile, JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // Swallow write errors - logging should never break execution
  }
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

/**
 * Validate agent output by checking that the expected deliverable exists
 * and optionally running agent-specific validators.
 */
export async function validateAgentOutput(
  result: ClaudePromptResult,
  agentName: AgentName,
  sourceDir: string,
  logger: ActivityLogger
): Promise<boolean> {
  if (!result.success) {
    return false;
  }

  const agentDef = AGENTS[agentName];
  if (!agentDef) {
    logger.warn(`No agent definition found for ${agentName}, skipping validation`);
    return true;
  }

  // Check that the deliverable file exists
  const deliverablePath = path.join(sourceDir, 'deliverables', agentDef.deliverableFilename);
  const exists = await fs.pathExists(deliverablePath);
  if (!exists) {
    logger.error(
      `Deliverable not found: ${deliverablePath} (expected from agent ${agentName})`
    );
    return false;
  }

  // Run agent-specific validator if one is registered
  const validator = AGENT_VALIDATORS[agentName];
  if (validator) {
    try {
      const valid = await validator(sourceDir, logger);
      if (!valid) {
        logger.error(`Agent-specific validation failed for ${agentName}`);
        return false;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Validator threw for ${agentName}: ${errMsg}`);
      return false;
    }
  }

  logger.info(`Output validation passed for ${agentName}: ${deliverablePath}`);
  return true;
}

// ---------------------------------------------------------------------------
// Message stream processing (adapted for eTest dispatchMessage API)
// ---------------------------------------------------------------------------

/**
 * Process an async message stream from the Claude SDK.
 *
 * The dispatchMessage call is fire-and-forget for side effects (audit logging,
 * progress updates). This function drives the message loop itself, extracting
 * result/cost data directly from ResultMessage payloads.
 */
async function processMessageStream(
  fullPrompt: string,
  options: NonNullable<Parameters<typeof query>[0]['options']>,
  deps: {
    description: string;
    agentName: string | null;
    progress: ProgressManager;
    auditLogger: AuditLogger;
    logger: ActivityLogger;
  },
  timer: Timer
): Promise<MessageLoopResult> {
  const execContext = detectExecutionContext(deps.description);
  const HEARTBEAT_INTERVAL = 30000;

  let turnCount = 0;
  let result: string | null = null;
  let apiErrorDetected = false;
  let cost = 0;
  let model: string | undefined;
  let lastHeartbeat = Date.now();

  for await (const message of query({ prompt: fullPrompt, options })) {
    // Heartbeat logging when progress indicator is disabled (CI / Docker)
    const now = Date.now();
    if (global.ETEST_DISABLE_LOADER && now - lastHeartbeat > HEARTBEAT_INTERVAL) {
      deps.logger.info(
        `[${Math.floor((now - timer.startTime) / 1000)}s] ${deps.description} running... (Turn ${turnCount})`
      );
      lastHeartbeat = now;
    }

    const msg = message as {
      type: string;
      subtype?: string;
      message?: string;
      data?: any;
      content?: any[];
      model?: string;
    };

    // Build shared dispatch deps (turn is updated on assistant messages)
    const dispatchDeps: MessageDispatchDeps = {
      auditLogger: deps.auditLogger,
      progressManager: deps.progress,
      context: execContext,
      description: deps.description,
      turn: turnCount,
    };

    if (msg.type === 'assistant') {
      turnCount++;
      dispatchDeps.turn = turnCount;
      dispatchMessage(
        { type: 'assistant', message: msg as AssistantMessage },
        dispatchDeps
      );
    } else if (msg.type === 'result') {
      const resultMsg = msg as ResultMessage;
      dispatchMessage(
        { type: 'result', message: resultMsg },
        dispatchDeps
      );

      if (resultMsg.data) {
        result = resultMsg.data.result;
        cost = resultMsg.data.total_cost_usd ?? resultMsg.data.cost_usd;
        if (resultMsg.data.model) {
          model = getActualModelName(resultMsg.data.model);
        }

        if (resultMsg.data.is_error) {
          const detection = detectApiError(resultMsg.data.result);
          if (detection.isBillingError || detection.isSessionLimit || detection.isApiError) {
            handleStructuredError(detection); // throws UATError
          }
          apiErrorDetected = true;
        }
      }
      break; // result terminates the stream
    } else if (msg.type === 'tool_use') {
      dispatchMessage(
        { type: 'tool_use', message: msg as ToolUseMessage },
        dispatchDeps
      );
    } else if (msg.type === 'tool_result') {
      dispatchMessage(
        { type: 'tool_result', message: msg as ToolResultMessage },
        dispatchDeps
      );
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      // Capture the model from the system init handshake
      if (msg.model) {
        model = getActualModelName(msg.model);
      }
    }
  }

  return { turnCount, result, apiErrorDetected, cost, model };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a Claude prompt with full MCP integration, streaming, and error handling.
 *
 * @param prompt       - The fully-rendered prompt text to send to Claude.
 * @param sourceDir    - Deliverables output directory (audit output path).
 *                       This is NOT a repo path; eTest is black-box against URLs.
 * @param sessionContext - An opaque session identifier for correlation.
 * @param agentName    - The agent name (key into AGENTS registry).
 * @param description  - Human-readable description of the execution.
 * @param auditSession - The audit session for structured event logging.
 * @param logger       - The activity logger for runtime messages.
 * @param modelTier    - Optional model tier override (defaults to medium).
 */
export async function runClaudePrompt(
  prompt: string,
  sourceDir: string,
  sessionContext: string,
  agentName: string,
  description: string,
  auditSession: AuditSession,
  logger: ActivityLogger,
  modelTier?: ModelTier
): Promise<ClaudePromptResult> {
  const timer = new Timer(`claude-prompt:${agentName}`);
  const model = resolveModel(modelTier);
  const actualModel = getActualModelName(model);
  const disableLoader = process.env['ETEST_DISABLE_LOADER'] === 'true';
  const progressManager = createProgressManager(!disableLoader);
  const auditLogger = createAuditLogger(auditSession);

  logger.info(`Starting Claude prompt for ${agentName} with model ${actualModel}`);
  progressManager.start({ description, agentName });

  try {
    const mcpServers = buildMcpServers(agentName, sourceDir);

    // Build env passthrough for SDK subprocess authentication
    const passthroughVars = [
      'HOME',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
      'AWS_REGION',
      'AWS_BEARER_TOKEN_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLOUD_ML_REGION',
      'ANTHROPIC_VERTEX_PROJECT_ID',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'ANTHROPIC_SMALL_MODEL',
      'ANTHROPIC_MEDIUM_MODEL',
      'ANTHROPIC_LARGE_MODEL',
      'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    ];
    const sdkEnv: Record<string, string> = {};
    for (const name of passthroughVars) {
      if (process.env[name]) sdkEnv[name] = process.env[name]!;
    }

    // Build SDK options
    const options: NonNullable<Parameters<typeof query>[0]['options']> = {
      model: actualModel,
      maxTurns: 50,
      mcpServers,
      systemPrompt: `You are a UAT testing agent (${agentName}). Session: ${sessionContext}. Write all deliverables to ${sourceDir}/deliverables/.`,
      env: sdkEnv,
    };

    // Process the async message stream
    const loopResult = await processMessageStream(
      prompt,
      options,
      {
        description,
        agentName,
        progress: progressManager,
        auditLogger,
        logger,
      },
      timer
    );

    const duration = timer.stop();
    progressManager.stop(formatCompletionMessage(description, !loopResult.apiErrorDetected, duration));

    // No result received at all
    if (loopResult.result === null && !loopResult.apiErrorDetected) {
      const errorMsg = 'No result received from Claude API';
      logger.error(`${agentName}: ${errorMsg}`);
      await writeErrorLog(sourceDir, agentName, errorMsg, { model: actualModel, sessionContext });
      return {
        success: false,
        error: errorMsg,
        duration,
        retryable: true,
      };
    }

    // Spending cap / zero-turn detection
    if (
      loopResult.result !== null &&
      isSpendingCapBehavior(loopResult.turnCount, loopResult.cost, loopResult.result)
    ) {
      const errorMsg = `Spending cap behavior detected: ${loopResult.result.slice(0, 200)}`;
      logger.warn(`${agentName}: ${errorMsg}`);
      await writeErrorLog(sourceDir, agentName, errorMsg, {
        turns: loopResult.turnCount,
        cost: loopResult.cost,
        model: loopResult.model ?? actualModel,
      });
      return {
        success: false,
        error: errorMsg,
        cost: loopResult.cost,
        duration,
        turns: loopResult.turnCount,
        model: loopResult.model ?? actualModel,
        retryable: true,
      };
    }

    // API error that was not fatal (did not throw via handleStructuredError)
    if (loopResult.apiErrorDetected) {
      const errText = loopResult.result ?? 'Unknown API error';
      logger.error(`${agentName}: API error in result: ${errText.slice(0, 200)}`);
      await writeErrorLog(sourceDir, agentName, errText, {
        turns: loopResult.turnCount,
        cost: loopResult.cost,
        model: loopResult.model ?? actualModel,
      });
      return {
        success: false,
        result: loopResult.result ?? undefined,
        error: errText,
        cost: loopResult.cost,
        duration,
        turns: loopResult.turnCount,
        model: loopResult.model ?? actualModel,
        retryable: true,
      };
    }

    // Success
    logger.info(
      `${agentName} completed: ${loopResult.turnCount} turns, $${loopResult.cost.toFixed(4)}, ${(duration / 1000).toFixed(1)}s`
    );
    return {
      success: true,
      result: loopResult.result ?? undefined,
      cost: loopResult.cost,
      duration,
      turns: loopResult.turnCount,
      model: loopResult.model ?? actualModel,
    };
  } catch (error) {
    const duration = timer.stop();
    progressManager.stop(formatErrorOutput(error instanceof Error ? error.message : String(error), description));

    if (error instanceof UATError) {
      logger.error(`UATError during ${agentName}: ${error.message}`);
      await writeErrorLog(sourceDir, agentName, error.message, {
        errorType: error.type,
        retryable: error.retryable,
        code: error.code,
      });
      return {
        success: false,
        error: error.message,
        duration,
        retryable: error.retryable,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error during ${agentName}: ${errorMessage}`);

    // Check if the error message indicates a known API issue
    const detection = detectApiError(errorMessage);
    if (detection.isBillingError || detection.isSessionLimit || detection.isApiError) {
      await writeErrorLog(sourceDir, agentName, errorMessage, {
        detectedAs: detection.isBillingError
          ? 'billing'
          : detection.isSessionLimit
            ? 'sessionLimit'
            : 'apiError',
      });
      return {
        success: false,
        error: errorMessage,
        duration,
        retryable: true,
      };
    }

    await writeErrorLog(sourceDir, agentName, errorMessage, { stack: (error as Error).stack });
    return {
      success: false,
      error: errorMessage,
      duration,
      retryable: true,
    };
  }
}
