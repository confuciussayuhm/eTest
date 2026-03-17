/**
 * Workflow Logger
 */

import fs from 'fs/promises';
import { generateWorkflowLogPath, type SessionMetadata } from './utils.js';
import { formatDuration, formatTimestamp } from '../utils/formatting.js';
import { LogStream } from './log-stream.js';

export interface AgentLogDetails {
  attemptNumber?: number;
  duration_ms?: number;
  cost_usd?: number;
  success?: boolean;
  error?: string;
}

export interface AgentMetricsSummary { durationMs: number; costUsd: number | null; }

export interface WorkflowSummary {
  status: 'completed' | 'failed';
  totalDurationMs: number;
  totalCostUsd: number;
  completedAgents: string[];
  agentMetrics: Record<string, AgentMetricsSummary>;
  error?: string;
}

export class WorkflowLogger {
  private readonly sessionMetadata: SessionMetadata;
  private readonly logStream: LogStream;

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.logStream = new LogStream(generateWorkflowLogPath(sessionMetadata));
  }

  async initialize(): Promise<void> {
    if (this.logStream.isOpen) return;
    await this.logStream.open();
    const stats = await fs.stat(this.logStream.path).catch(() => null);
    if (!stats || stats.size === 0) await this.writeHeader();
  }

  private async writeHeader(): Promise<void> {
    const header = [
      `================================================================================`,
      `eTest UAT - Workflow Log`,
      `================================================================================`,
      `Workflow ID: ${this.sessionMetadata.id}`,
      `Target URL:  ${this.sessionMetadata.webUrl}`,
      `Started:     ${formatTimestamp()}`,
      `================================================================================`, '',
    ].join('\n');
    return this.logStream.write(header);
  }

  async logResumeHeader(resumeInfo: { previousWorkflowId: string; newWorkflowId: string; checkpointHash: string; completedAgents: string[]; }): Promise<void> {
    await this.ensureInitialized();
    const header = ['', `================================================================================`, `RESUMED`, `================================================================================`,
      `Previous Workflow ID: ${resumeInfo.previousWorkflowId}`, `New Workflow ID:      ${resumeInfo.newWorkflowId}`,
      `Resumed At:           ${formatTimestamp()}`, `Checkpoint:           ${resumeInfo.checkpointHash}`,
      `Completed:            ${resumeInfo.completedAgents.length} agents (${resumeInfo.completedAgents.join(', ')})`,
      `================================================================================`, ''].join('\n');
    return this.logStream.write(header);
  }

  private formatLogTime(): string { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

  async logPhase(phase: string, event: 'start' | 'complete'): Promise<void> {
    await this.ensureInitialized();
    const action = event === 'start' ? 'Starting' : 'Completed';
    if (event === 'start') await this.logStream.write('\n');
    await this.logStream.write(`[${this.formatLogTime()}] [PHASE] ${action}: ${phase}\n`);
  }

  async logAgent(agentName: string, event: 'start' | 'end', details?: AgentLogDetails): Promise<void> {
    await this.ensureInitialized();
    let message: string;
    if (event === 'start') {
      message = `${agentName}: Starting (attempt ${details?.attemptNumber ?? 1})`;
    } else {
      const parts: string[] = [agentName + ':'];
      if (details?.success === false) { parts.push('Failed'); if (details?.error) parts.push(`- ${details.error}`); }
      else parts.push('Completed');
      if (details?.duration_ms !== undefined) {
        parts.push(`(${formatDuration(details.duration_ms)}`);
        parts.push(details?.cost_usd !== undefined ? `$${details.cost_usd.toFixed(2)})` : ')');
      }
      message = parts.join(' ');
    }
    await this.logStream.write(`[${this.formatLogTime()}] [AGENT] ${message}\n`);
  }

  async logToolStart(agentName: string, toolName: string, parameters: unknown): Promise<void> {
    await this.ensureInitialized();
    const paramStr = parameters && typeof parameters === 'object' ? `: ${JSON.stringify(parameters).slice(0, 100)}` : '';
    await this.logStream.write(`[${this.formatLogTime()}] [${agentName}] [TOOL] ${toolName}${paramStr}\n`);
  }

  async logLlmResponse(agentName: string, turn: number, content: string): Promise<void> {
    await this.ensureInitialized();
    const escaped = content.replace(/\n/g, '\\n');
    await this.logStream.write(`[${this.formatLogTime()}] [${agentName}] [LLM] Turn ${turn}: ${escaped}\n`);
  }

  async logWorkflowComplete(summary: WorkflowSummary): Promise<void> {
    await this.ensureInitialized();
    const status = summary.status === 'completed' ? 'COMPLETED' : 'FAILED';
    await this.logStream.write('\n');
    await this.logStream.write(`================================================================================\n`);
    await this.logStream.write(`Workflow ${status}\n`);
    await this.logStream.write(`Duration:    ${formatDuration(summary.totalDurationMs)}\n`);
    await this.logStream.write(`Total Cost:  $${summary.totalCostUsd.toFixed(4)}\n`);
    await this.logStream.write(`Agents:      ${summary.completedAgents.length} completed\n`);
    if (summary.error) await this.logStream.write(`Error:       ${summary.error}\n`);
    await this.logStream.write(`\nAgent Breakdown:\n`);
    for (const agentName of summary.completedAgents) {
      const metrics = summary.agentMetrics[agentName];
      if (metrics) {
        await this.logStream.write(`  - ${agentName} (${formatDuration(metrics.durationMs)}, ${metrics.costUsd !== null ? '$' + metrics.costUsd.toFixed(4) : 'N/A'})\n`);
      } else {
        await this.logStream.write(`  - ${agentName}\n`);
      }
    }
    await this.logStream.write(`================================================================================\n`);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.logStream.isOpen) await this.initialize();
  }

  async close(): Promise<void> { return this.logStream.close(); }
}
