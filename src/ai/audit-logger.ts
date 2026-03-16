/**
 * Audit Logger
 *
 * Provides audit logging for AI execution events, wrapping
 * the audit session with a simplified interface for the AI layer.
 */

import { AuditSession } from '../audit/index.js';
import { formatTimestamp } from '../utils/formatting.js';

export interface AuditLogger {
  logToolStart(toolName: string, parameters?: unknown): Promise<void>;
  logToolEnd(toolName: string, result: string, isError: boolean, durationMs: number): Promise<void>;
  logLlmResponse(turn: number, content: string): Promise<void>;
  logEvent(eventType: string, data: unknown): Promise<void>;
}

export class RealAuditLogger implements AuditLogger {
  private readonly session: AuditSession;

  constructor(session: AuditSession) {
    this.session = session;
  }

  async logToolStart(toolName: string, parameters?: unknown): Promise<void> {
    await this.session.logEvent('tool_start', {
      toolName,
      parameters,
      timestamp: formatTimestamp(),
    });
  }

  async logToolEnd(toolName: string, result: string, isError: boolean, durationMs: number): Promise<void> {
    await this.session.logEvent('tool_end', {
      toolName,
      result: result.slice(0, 2000),
      isError,
      durationMs,
      timestamp: formatTimestamp(),
    });
  }

  async logLlmResponse(turn: number, content: string): Promise<void> {
    await this.session.logEvent('llm_response', {
      turn,
      content: content.slice(0, 5000),
      timestamp: formatTimestamp(),
    });
  }

  async logEvent(eventType: string, data: unknown): Promise<void> {
    await this.session.logEvent(eventType, data);
  }
}

export class NullAuditLogger implements AuditLogger {
  async logToolStart(_toolName: string, _parameters?: unknown): Promise<void> {
    // No-op
  }

  async logToolEnd(_toolName: string, _result: string, _isError: boolean, _durationMs: number): Promise<void> {
    // No-op
  }

  async logLlmResponse(_turn: number, _content: string): Promise<void> {
    // No-op
  }

  async logEvent(_eventType: string, _data: unknown): Promise<void> {
    // No-op
  }
}

/**
 * Create an audit logger, wrapping the session if provided.
 */
export function createAuditLogger(session: AuditSession | null): AuditLogger {
  return session ? new RealAuditLogger(session) : new NullAuditLogger();
}
