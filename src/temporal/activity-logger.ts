/**
 * Activity-scoped logger that bridges Temporal's activity context
 * to a simple ActivityLogger interface consumed by services.
 *
 * Copied from Shannon -- no domain-specific changes required.
 */

import { Context } from '@temporalio/activity';
import type { ActivityLogger } from '../types/activity-logger.js';

/**
 * Logger implementation that prefixes every message with the Temporal
 * activity info (task-queue, activity type) and delegates to the
 * activity context logger when available, falling back to console.
 */
export class TemporalActivityLogger implements ActivityLogger {
  private readonly prefix: string;

  constructor(activityName: string) {
    this.prefix = `[activity:${activityName}]`;
  }

  info(message: string, attrs?: Record<string, unknown>): void {
    const line = this.format(message, attrs);
    if (this.hasContext()) {
      Context.current().log.info(line);
    } else {
      console.log(`${this.prefix} INFO ${line}`);
    }
  }

  warn(message: string, attrs?: Record<string, unknown>): void {
    const line = this.format(message, attrs);
    if (this.hasContext()) {
      Context.current().log.warn(line);
    } else {
      console.warn(`${this.prefix} WARN ${line}`);
    }
  }

  error(message: string, attrs?: Record<string, unknown>): void {
    const line = this.format(message, attrs);
    if (this.hasContext()) {
      Context.current().log.error(line);
    } else {
      console.error(`${this.prefix} ERROR ${line}`);
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private format(message: string, attrs?: Record<string, unknown>): string {
    if (!attrs || Object.keys(attrs).length === 0) return message;
    return `${message} ${JSON.stringify(attrs)}`;
  }

  private hasContext(): boolean {
    try {
      Context.current();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Factory function -- creates a logger for a named activity.
 */
export function createActivityLogger(activityName: string): ActivityLogger {
  return new TemporalActivityLogger(activityName);
}
