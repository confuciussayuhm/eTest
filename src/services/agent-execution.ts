/**
 * Agent Execution Service
 */

import type { ActivityLogger } from '../types/activity-logger.js';
import { Result, ok, err, isErr } from '../types/result.js';
import { ErrorCode, type UATErrorType } from '../types/errors.js';
import { UATError } from './error-handling.js';
import { isSpendingCapBehavior } from '../utils/billing-detection.js';
import { AGENTS } from '../session-manager.js';
import { loadPrompt } from './prompt-manager.js';
import {
  runClaudePrompt,
  validateAgentOutput,
  type ClaudePromptResult,
} from '../ai/claude-executor.js';
import {
  createGitCheckpoint,
  commitGitSuccess,
  rollbackGitWorkspace,
  getGitCommitHash,
} from './git-manager.js';
import { AuditSession } from '../audit/index.js';
import type { AgentEndResult } from '../types/audit.js';
import type { AgentName } from '../types/agents.js';
import type { ConfigLoaderService } from './config-loader.js';
import type { AgentMetrics } from '../types/metrics.js';

export interface AgentExecutionInput {
  webUrl: string;
  configPath?: string | undefined;
  pipelineTestingMode?: boolean | undefined;
  attemptNumber: number;
}

interface FailAgentOpts {
  attemptNumber: number;
  result: ClaudePromptResult;
  rollbackReason: string;
  errorMessage: string;
  errorCode: ErrorCode;
  category: UATErrorType;
  retryable: boolean;
  context: Record<string, unknown>;
}

export class AgentExecutionService {
  private readonly configLoader: ConfigLoaderService;

  constructor(configLoader: ConfigLoaderService) {
    this.configLoader = configLoader;
  }

  async execute(
    agentName: AgentName,
    input: AgentExecutionInput,
    auditSession: AuditSession,
    logger: ActivityLogger
  ): Promise<Result<AgentEndResult, UATError>> {
    const { webUrl, configPath, pipelineTestingMode = false, attemptNumber } = input;
    const sourceDir = process.cwd();

    const configResult = await this.configLoader.loadOptional(configPath);
    if (isErr(configResult)) return configResult;
    const distributedConfig = configResult.value;

    const promptTemplate = AGENTS[agentName].promptTemplate;
    let prompt: string;
    try {
      prompt = await loadPrompt(promptTemplate, { webUrl }, distributedConfig, pipelineTestingMode, logger);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new UATError(
        `Failed to load prompt for ${agentName}: ${errorMessage}`,
        'prompt', false,
        { agentName, promptTemplate, originalError: errorMessage },
        ErrorCode.PROMPT_LOAD_FAILED
      ));
    }

    try {
      await createGitCheckpoint(sourceDir, agentName, attemptNumber, logger);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new UATError(
        `Failed to create git checkpoint for ${agentName}: ${errorMessage}`,
        'filesystem', false,
        { agentName, originalError: errorMessage },
        ErrorCode.GIT_CHECKPOINT_FAILED
      ));
    }

    await auditSession.startAgent(agentName, prompt, attemptNumber);

    const result: ClaudePromptResult = await runClaudePrompt(
      prompt, sourceDir, '', agentName, agentName,
      auditSession, logger, AGENTS[agentName].modelTier
    );

    if (result.success && (result.turns ?? 0) <= 2 && (result.cost || 0) === 0) {
      const resultText = result.result || '';
      if (isSpendingCapBehavior(result.turns ?? 0, result.cost || 0, resultText)) {
        return this.failAgent(agentName, sourceDir, auditSession, logger, {
          attemptNumber, result,
          rollbackReason: 'spending cap detected',
          errorMessage: `Spending cap likely reached: ${resultText.slice(0, 100)}`,
          errorCode: ErrorCode.SPENDING_CAP_REACHED,
          category: 'billing', retryable: true,
          context: { agentName, turns: result.turns, cost: result.cost },
        });
      }
    }

    if (!result.success) {
      return this.failAgent(agentName, sourceDir, auditSession, logger, {
        attemptNumber, result,
        rollbackReason: 'execution failure',
        errorMessage: result.error || 'Agent execution failed',
        errorCode: ErrorCode.AGENT_EXECUTION_FAILED,
        category: 'validation', retryable: result.retryable ?? true,
        context: { agentName, originalError: result.error },
      });
    }

    const validationPassed = await validateAgentOutput(result, agentName, sourceDir, logger);
    if (!validationPassed) {
      return this.failAgent(agentName, sourceDir, auditSession, logger, {
        attemptNumber, result,
        rollbackReason: 'validation failure',
        errorMessage: `Agent ${agentName} failed output validation`,
        errorCode: ErrorCode.OUTPUT_VALIDATION_FAILED,
        category: 'validation', retryable: true,
        context: { agentName, deliverableFilename: AGENTS[agentName].deliverableFilename },
      });
    }

    await commitGitSuccess(sourceDir, agentName, logger);
    const commitHash = await getGitCommitHash(sourceDir);

    const endResult: AgentEndResult = {
      attemptNumber,
      duration_ms: result.duration,
      cost_usd: result.cost || 0,
      success: true,
      model: result.model,
      ...(commitHash && { checkpoint: commitHash }),
    };
    await auditSession.endAgent(agentName, endResult);
    return ok(endResult);
  }

  private async failAgent(
    agentName: AgentName,
    sourceDir: string,
    auditSession: AuditSession,
    logger: ActivityLogger,
    opts: FailAgentOpts
  ): Promise<Result<AgentEndResult, UATError>> {
    await rollbackGitWorkspace(sourceDir, opts.rollbackReason, logger);
    const endResult: AgentEndResult = {
      attemptNumber: opts.attemptNumber,
      duration_ms: opts.result.duration,
      cost_usd: opts.result.cost || 0,
      success: false,
      model: opts.result.model,
      error: opts.errorMessage,
    };
    await auditSession.endAgent(agentName, endResult);
    return err(new UATError(opts.errorMessage, opts.category, opts.retryable, opts.context, opts.errorCode));
  }

  async executeOrThrow(
    agentName: AgentName,
    input: AgentExecutionInput,
    auditSession: AuditSession,
    logger: ActivityLogger
  ): Promise<AgentEndResult> {
    const result = await this.execute(agentName, input, auditSession, logger);
    if (isErr(result)) throw result.error;
    return result.value;
  }

  static toMetrics(endResult: AgentEndResult, result: ClaudePromptResult): AgentMetrics {
    return {
      durationMs: endResult.duration_ms,
      inputTokens: null,
      outputTokens: null,
      costUsd: endResult.cost_usd,
      numTurns: result.turns ?? null,
      model: result.model,
    };
  }
}
