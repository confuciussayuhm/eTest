/**
 * Metrics Tracker - session.json management
 */

import { generateSessionJsonPath, type SessionMetadata } from './utils.js';
import { atomicWrite, readJson, fileExists } from '../utils/file-io.js';
import { formatTimestamp, calculatePercentage } from '../utils/formatting.js';
import { AGENT_PHASE_MAP, type PhaseName } from '../types/agents.js';
import { UATError } from '../services/error-handling.js';
import { ErrorCode } from '../types/errors.js';
import type { AgentName, AgentEndResult } from '../types/index.js';

interface AttemptData { attempt_number: number; duration_ms: number; cost_usd: number; success: boolean; timestamp: string; model?: string; error?: string; }
interface AgentAuditMetrics { status: 'in-progress' | 'success' | 'failed'; attempts: AttemptData[]; final_duration_ms: number; total_cost_usd: number; model?: string; checkpoint?: string; }
interface PhaseMetrics { duration_ms: number; duration_percentage: number; cost_usd: number; agent_count: number; }

export interface ResumeAttempt { workflowId: string; timestamp: string; terminatedPrevious?: string; resumedFromCheckpoint?: string; }

interface SessionData {
  session: { id: string; webUrl: string; status: 'in-progress' | 'completed' | 'failed'; createdAt: string; completedAt?: string; originalWorkflowId?: string; resumeAttempts?: ResumeAttempt[]; };
  metrics: { total_duration_ms: number; total_cost_usd: number; phases: Record<string, PhaseMetrics>; agents: Record<string, AgentAuditMetrics>; };
}

interface ActiveTimer { startTime: number; attemptNumber: number; }

export class MetricsTracker {
  private sessionMetadata: SessionMetadata;
  private sessionJsonPath: string;
  private data: SessionData | null = null;
  private activeTimers: Map<string, ActiveTimer> = new Map();

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.sessionJsonPath = generateSessionJsonPath(sessionMetadata);
  }

  async initialize(workflowId?: string): Promise<void> {
    const exists = await fileExists(this.sessionJsonPath);
    if (exists) { this.data = await readJson<SessionData>(this.sessionJsonPath); }
    else { this.data = this.createInitialData(workflowId); await this.save(); }
  }

  private createInitialData(workflowId?: string): SessionData {
    const data: SessionData = {
      session: { id: this.sessionMetadata.id, webUrl: this.sessionMetadata.webUrl, status: 'in-progress', createdAt: formatTimestamp(), resumeAttempts: [] },
      metrics: { total_duration_ms: 0, total_cost_usd: 0, phases: {}, agents: {} },
    };
    if (workflowId) data.session.originalWorkflowId = workflowId;
    return data;
  }

  startAgent(agentName: string, attemptNumber: number): void {
    this.activeTimers.set(agentName, { startTime: Date.now(), attemptNumber });
  }

  async endAgent(agentName: string, result: AgentEndResult): Promise<void> {
    if (!this.data) throw new UATError('MetricsTracker not initialized', 'validation', false, {}, ErrorCode.AGENT_EXECUTION_FAILED);
    const agent = this.data.metrics.agents[agentName] ?? { status: 'in-progress' as const, attempts: [], final_duration_ms: 0, total_cost_usd: 0 };
    this.data.metrics.agents[agentName] = agent;
    const attempt: AttemptData = { attempt_number: result.attemptNumber, duration_ms: result.duration_ms, cost_usd: result.cost_usd, success: result.success, timestamp: formatTimestamp() };
    if (result.model) attempt.model = result.model;
    if (result.error) attempt.error = result.error;
    agent.attempts.push(attempt);
    agent.total_cost_usd = agent.attempts.reduce((sum, a) => sum + a.cost_usd, 0);
    if (result.success) {
      agent.status = 'success';
      agent.final_duration_ms = result.duration_ms;
      if (result.model) agent.model = result.model;
      if (result.checkpoint) agent.checkpoint = result.checkpoint;
    } else if (result.isFinalAttempt) { agent.status = 'failed'; }
    this.activeTimers.delete(agentName);
    this.recalculateAggregations();
    await this.save();
  }

  async updateSessionStatus(status: 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.data) return;
    this.data.session.status = status;
    if (status === 'completed' || status === 'failed') this.data.session.completedAt = formatTimestamp();
    await this.save();
  }

  async addResumeAttempt(workflowId: string, terminatedWorkflows: string[], checkpointHash?: string): Promise<void> {
    if (!this.data) throw new UATError('MetricsTracker not initialized', 'validation', false, {}, ErrorCode.AGENT_EXECUTION_FAILED);
    if (!this.data.session.originalWorkflowId) this.data.session.originalWorkflowId = this.data.session.id;
    if (!this.data.session.resumeAttempts) this.data.session.resumeAttempts = [];
    const attempt: ResumeAttempt = { workflowId, timestamp: formatTimestamp() };
    if (terminatedWorkflows.length > 0) attempt.terminatedPrevious = terminatedWorkflows.join(',');
    if (checkpointHash) attempt.resumedFromCheckpoint = checkpointHash;
    this.data.session.resumeAttempts.push(attempt);
    await this.save();
  }

  private recalculateAggregations(): void {
    if (!this.data) return;
    const successfulAgents = Object.entries(this.data.metrics.agents).filter(([, d]) => d.status === 'success');
    this.data.metrics.total_duration_ms = successfulAgents.reduce((sum, [, d]) => sum + d.final_duration_ms, 0);
    this.data.metrics.total_cost_usd = successfulAgents.reduce((sum, [, d]) => sum + d.total_cost_usd, 0);
    this.data.metrics.phases = this.calculatePhaseMetrics(successfulAgents);
  }

  private calculatePhaseMetrics(successfulAgents: Array<[string, AgentAuditMetrics]>): Record<string, PhaseMetrics> {
    const phases: Record<PhaseName, AgentAuditMetrics[]> = {
      'discovery': [], 'scenario-planning': [], 'test-planning': [], 'test-execution': [], 'multi-persona': [], 'reporting': [],
    };
    for (const [agentName, agentData] of successfulAgents) {
      const phase = AGENT_PHASE_MAP[agentName as AgentName];
      if (phase) phases[phase].push(agentData);
    }
    const phaseMetrics: Record<string, PhaseMetrics> = {};
    const totalDuration = this.data!.metrics.total_duration_ms;
    for (const [phaseName, agentList] of Object.entries(phases)) {
      if (agentList.length === 0) continue;
      const pd = agentList.reduce((sum, a) => sum + a.final_duration_ms, 0);
      phaseMetrics[phaseName] = { duration_ms: pd, duration_percentage: calculatePercentage(pd, totalDuration), cost_usd: agentList.reduce((sum, a) => sum + a.total_cost_usd, 0), agent_count: agentList.length };
    }
    return phaseMetrics;
  }

  getMetrics(): SessionData { return JSON.parse(JSON.stringify(this.data)) as SessionData; }
  private async save(): Promise<void> { if (!this.data) return; await atomicWrite(this.sessionJsonPath, this.data); }
  async reload(): Promise<void> { this.data = await readJson<SessionData>(this.sessionJsonPath); }
}
