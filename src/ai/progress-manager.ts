/**
 * Progress Manager
 *
 * Manages progress indicators during agent execution,
 * providing visual feedback on long-running operations.
 */

import { ProgressIndicator } from '../progress-indicator.js';
import { extractAgentType } from '../utils/formatting.js';

export interface ProgressContext {
  description: string;
  agentName: string;
}

export interface ProgressManager {
  start(context: ProgressContext): void;
  updateTool(toolName: string): void;
  updateMessage(message: string): void;
  stop(finalMessage?: string): void;
  isActive(): boolean;
}

export class RealProgressManager implements ProgressManager {
  private indicator: ProgressIndicator | null = null;
  private active: boolean = false;

  start(context: ProgressContext): void {
    const agentType = extractAgentType(context.description);
    this.indicator = new ProgressIndicator(
      `Running ${agentType} agent: ${context.agentName}`
    );
    this.indicator.start();
    this.active = true;
  }

  updateTool(toolName: string): void {
    if (this.indicator) {
      this.indicator.update(`Tool: ${toolName}`);
    }
  }

  updateMessage(message: string): void {
    if (this.indicator) {
      this.indicator.update(message);
    }
  }

  stop(finalMessage?: string): void {
    if (this.indicator) {
      this.indicator.stop(finalMessage);
      this.indicator = null;
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

export class NullProgressManager implements ProgressManager {
  start(_context: ProgressContext): void {
    // No-op for headless/parallel execution
  }

  updateTool(_toolName: string): void {
    // No-op
  }

  updateMessage(_message: string): void {
    // No-op
  }

  stop(_finalMessage?: string): void {
    // No-op
  }

  isActive(): boolean {
    return false;
  }
}

/**
 * Create a progress manager based on whether progress display is enabled.
 */
export function createProgressManager(enabled: boolean): ProgressManager {
  return enabled ? new RealProgressManager() : new NullProgressManager();
}
