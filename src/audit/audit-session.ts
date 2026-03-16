/**
 * Audit Session - Main Facade
 */

import { AgentLogger } from './logger.js';
import { WorkflowLogger, type AgentLogDetails, type WorkflowSummary } from './workflow-logger.js';
import { MetricsTracker } from './metrics-tracker.js';
import { initializeAuditStructure, type SessionMetadata } from './utils.js';
import { formatTimestamp } from '../utils/formatting.js';
import { SessionMutex } from '../utils/concurrency.js';
import type { AgentEndResult } from '../types/index.js';
import { UATError } from '../services/error-handling.js';
import { ErrorCode } from '../types/errors.js';

const sessionMutex = new SessionMutex();

export class AuditSession {
  private sessionMetadata: SessionMetadata;
  private sessionId: string;
  private metricsTracker: MetricsTracker;
  private workflowLogger: WorkflowLogger;
  private currentLogger: AgentLogger | null = null;
  private currentAgentName: string | null = null;
  private initialized: boolean = false;

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.sessionId = sessionMetadata.id;
    if (!this.sessionId) throw new UATError('sessionMetadata.id is required', 'config', false, {}, ErrorCode.CONFIG_VALIDATION_FAILED);
    if (!this.sessionMetadata.webUrl) throw new UATError('sessionMetadata.webUrl is required', 'config', false, {}, ErrorCode.CONFIG_VALIDATION_FAILED);
    this.metricsTracker = new MetricsTracker(sessionMetadata);
    this.workflowLogger = new WorkflowLogger(sessionMetadata);
  }

  async initialize(workflowId?: string): Promise<void> {
    if (this.initialized) return;
    await initializeAuditStructure(this.sessionMetadata);
    await this.metricsTracker.initialize(workflowId);
    await this.workflowLogger.initialize();
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> { if (!this.initialized) await this.initialize(); }

  async startAgent(agentName: string, promptContent: string, attemptNumber: number = 1): Promise<void> {
    await this.ensureInitialized();
    if (attemptNumber === 1) await AgentLogger.savePrompt(this.sessionMetadata, agentName, promptContent);
    this.currentAgentName = agentName;
    this.currentLogger = new AgentLogger(this.sessionMetadata, agentName, attemptNumber);
    await this.currentLogger.initialize();
    this.metricsTracker.startAgent(agentName, attemptNumber);
    await this.currentLogger.logEvent('agent_start', { agentName, attemptNumber, timestamp: formatTimestamp() });
    await this.workflowLogger.logAgent(agentName, 'start', { attemptNumber });
  }

  async logEvent(eventType: string, eventData: unknown): Promise<void> {
    if (!this.currentLogger) throw new UATError('No active logger. Call startAgent() first.', 'validation', false, {}, ErrorCode.AGENT_EXECUTION_FAILED);
    await this.currentLogger.logEvent(eventType, eventData);
    const data = eventData as Record<string, unknown>;
    const agentName = this.currentAgentName || 'unknown';
    switch (eventType) {
      case 'tool_start': await this.workflowLogger.logToolStart(agentName, String(data.toolName || ''), data.parameters); break;
      case 'llm_response': await this.workflowLogger.logLlmResponse(agentName, Number(data.turn || 0), String(data.content || '')); break;
    }
  }

  async endAgent(agentName: string, result: AgentEndResult): Promise<void> {
    if (this.currentLogger) {
      await this.currentLogger.logEvent('agent_end', { agentName, success: result.success, duration_ms: result.duration_ms, cost_usd: result.cost_usd, timestamp: formatTimestamp() });
      await this.currentLogger.close();
      this.currentLogger = null;
    }
    this.currentAgentName = null;
    const details: AgentLogDetails = { attemptNumber: result.attemptNumber, duration_ms: result.duration_ms, cost_usd: result.cost_usd, success: result.success, ...(result.error !== undefined && { error: result.error }) };
    await this.workflowLogger.logAgent(agentName, 'end', details);
    const unlock = await sessionMutex.lock(this.sessionId);
    try { await this.metricsTracker.reload(); await this.metricsTracker.endAgent(agentName, result); }
    finally { unlock(); }
  }

  async updateSessionStatus(status: 'in-progress' | 'completed' | 'failed'): Promise<void> {
    await this.ensureInitialized();
    const unlock = await sessionMutex.lock(this.sessionId);
    try { await this.metricsTracker.reload(); await this.metricsTracker.updateSessionStatus(status); }
    finally { unlock(); }
  }

  async getMetrics(): Promise<unknown> { await this.ensureInitialized(); return this.metricsTracker.getMetrics(); }
  async logPhaseStart(phase: string): Promise<void> { await this.ensureInitialized(); await this.workflowLogger.logPhase(phase, 'start'); }
  async logPhaseComplete(phase: string): Promise<void> { await this.ensureInitialized(); await this.workflowLogger.logPhase(phase, 'complete'); }
  async logWorkflowComplete(summary: WorkflowSummary): Promise<void> { await this.ensureInitialized(); await this.workflowLogger.logWorkflowComplete(summary); }

  async addResumeAttempt(workflowId: string, terminatedWorkflows: string[], checkpointHash?: string): Promise<void> {
    await this.ensureInitialized();
    const unlock = await sessionMutex.lock(this.sessionId);
    try { await this.metricsTracker.reload(); await this.metricsTracker.addResumeAttempt(workflowId, terminatedWorkflows, checkpointHash); }
    finally { unlock(); }
  }

  async logResumeHeader(resumeInfo: { previousWorkflowId: string; newWorkflowId: string; checkpointHash: string; completedAgents: string[]; }): Promise<void> {
    await this.ensureInitialized();
    await this.workflowLogger.logResumeHeader(resumeInfo);
  }
}
