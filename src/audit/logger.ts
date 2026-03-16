/**
 * Append-Only Agent Logger
 */

import { generateLogPath, generatePromptPath, type SessionMetadata } from './utils.js';
import { atomicWrite } from '../utils/file-io.js';
import { formatTimestamp } from '../utils/formatting.js';
import { LogStream } from './log-stream.js';

interface LogEvent { type: string; timestamp: string; data: unknown; }

export class AgentLogger {
  private readonly sessionMetadata: SessionMetadata;
  private readonly agentName: string;
  private readonly attemptNumber: number;
  private readonly timestamp: number;
  private readonly logStream: LogStream;

  constructor(sessionMetadata: SessionMetadata, agentName: string, attemptNumber: number) {
    this.sessionMetadata = sessionMetadata;
    this.agentName = agentName;
    this.attemptNumber = attemptNumber;
    this.timestamp = Date.now();
    this.logStream = new LogStream(generateLogPath(sessionMetadata, agentName, this.timestamp, attemptNumber));
  }

  async initialize(): Promise<void> {
    if (this.logStream.isOpen) return;
    await this.logStream.open();
    await this.writeHeader();
  }

  private async writeHeader(): Promise<void> {
    const header = [
      `========================================`,
      `Agent: ${this.agentName}`,
      `Attempt: ${this.attemptNumber}`,
      `Started: ${formatTimestamp(this.timestamp)}`,
      `Session: ${this.sessionMetadata.id}`,
      `Target: ${this.sessionMetadata.webUrl}`,
      `========================================\n`,
    ].join('\n');
    return this.logStream.write(header);
  }

  async logEvent(eventType: string, eventData: unknown): Promise<void> {
    const event: LogEvent = { type: eventType, timestamp: formatTimestamp(), data: eventData };
    return this.logStream.write(`${JSON.stringify(event)}\n`);
  }

  async close(): Promise<void> { return this.logStream.close(); }

  static async savePrompt(sessionMetadata: SessionMetadata, agentName: string, promptContent: string): Promise<void> {
    const promptPath = generatePromptPath(sessionMetadata, agentName);
    const header = [`# Prompt Snapshot: ${agentName}`, '', `**Session:** ${sessionMetadata.id}`, `**Target:** ${sessionMetadata.webUrl}`, `**Saved:** ${formatTimestamp()}`, '', `---`, ''].join('\n');
    await atomicWrite(promptPath, header + promptContent);
  }
}
