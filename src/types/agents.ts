/**
 * Agent type definitions for UAT framework
 */

import type { ActivityLogger } from './activity-logger.js';

export const ALL_AGENTS = [
  'discovery',
  'scenario-planning',
  'navigation-plan', 'navigation-exec',
  'forms-plan', 'forms-exec',
  'auth-plan', 'auth-exec',
  'authz-plan', 'authz-exec',
  'data-plan', 'data-exec',
  'uiux-plan', 'uiux-exec',
  'api-plan', 'api-exec',
  'crossbrowser-plan', 'crossbrowser-exec',
  'a11y-plan', 'a11y-exec',
  'performance-plan', 'performance-exec',
  'errors-plan', 'errors-exec',
  'e2e-plan', 'e2e-exec',
  'multi-persona-setup', 'multi-persona-record',
  'multi-persona-replay', 'multi-persona-analysis',
  'report',
] as const;

export type AgentName = typeof ALL_AGENTS[number];

export type TestCategory =
  | 'navigation'
  | 'forms'
  | 'auth'
  | 'authz'
  | 'data'
  | 'uiux'
  | 'api'
  | 'crossbrowser'
  | 'a11y'
  | 'performance'
  | 'errors'
  | 'e2e';

export type PlaywrightAgent =
  | 'playwright-agent1'
  | 'playwright-agent2'
  | 'playwright-agent3'
  | 'playwright-agent4'
  | 'playwright-agent5'
  | 'playwright-agent6'
  | 'playwright-agent7'
  | 'playwright-agent8'
  | 'playwright-agent9'
  | 'playwright-agent10'
  | 'playwright-agent11'
  | 'playwright-agent12';

export type AgentValidator = (sourceDir: string, logger: ActivityLogger) => Promise<boolean>;

export type AgentStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled-back';

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  prerequisites: AgentName[];
  promptTemplate: string;
  deliverableFilename: string;
  modelTier?: 'small' | 'medium' | 'large';
}

/**
 * Decision returned by test readiness check for execution phase.
 */
export interface ExecutionDecision {
  shouldExecute: boolean;
  shouldRetry: boolean;
  testCaseCount: number;
  testCategory: TestCategory;
}

export type PhaseName = 'discovery' | 'scenario-planning' | 'test-planning' | 'test-execution' | 'multi-persona' | 'reporting';

export const AGENT_PHASE_MAP: Readonly<Record<AgentName, PhaseName>> = Object.freeze({
  'discovery': 'discovery',
  'scenario-planning': 'scenario-planning',
  'navigation-plan': 'test-planning',
  'forms-plan': 'test-planning',
  'auth-plan': 'test-planning',
  'authz-plan': 'test-planning',
  'data-plan': 'test-planning',
  'uiux-plan': 'test-planning',
  'api-plan': 'test-planning',
  'crossbrowser-plan': 'test-planning',
  'a11y-plan': 'test-planning',
  'performance-plan': 'test-planning',
  'errors-plan': 'test-planning',
  'e2e-plan': 'test-planning',
  'navigation-exec': 'test-execution',
  'forms-exec': 'test-execution',
  'auth-exec': 'test-execution',
  'authz-exec': 'test-execution',
  'data-exec': 'test-execution',
  'uiux-exec': 'test-execution',
  'api-exec': 'test-execution',
  'crossbrowser-exec': 'test-execution',
  'a11y-exec': 'test-execution',
  'performance-exec': 'test-execution',
  'errors-exec': 'test-execution',
  'e2e-exec': 'test-execution',
  'multi-persona-setup': 'multi-persona',
  'multi-persona-record': 'multi-persona',
  'multi-persona-replay': 'multi-persona',
  'multi-persona-analysis': 'multi-persona',
  'report': 'reporting',
});
