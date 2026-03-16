/**
 * Session Manager - UAT Agent Registry
 *
 * Defines the 31-agent UAT workflow: discovery, scenario-planning,
 * 12 plan/exec pairs, 4 multi-persona agents, and report.
 * Maps agents to Playwright instances and provides validators.
 *
 * NOTE: deliverableFilename values must match mcp-server/src/types/deliverables.ts:DELIVERABLE_FILENAMES
 */

import { path, fs } from 'zx';
import { validateQueueAndDeliverable } from './services/queue-validation.js';
import type { AgentName, AgentDefinition, PlaywrightAgent, AgentValidator, TestCategory } from './types/index.js';
import type { ActivityLogger } from './types/activity-logger.js';

// Agent definitions according to PRD
export const AGENTS: Readonly<Record<AgentName, AgentDefinition>> = Object.freeze({
  'discovery': {
    name: 'discovery',
    displayName: 'Discovery agent',
    prerequisites: [],
    promptTemplate: 'discovery',
    deliverableFilename: 'discovery_deliverable.md',
    modelTier: 'large',
  },
  'scenario-planning': {
    name: 'scenario-planning',
    displayName: 'Scenario Planning agent',
    prerequisites: ['discovery'],
    promptTemplate: 'scenario-planning',
    deliverableFilename: 'scenario_planning_deliverable.md',
    modelTier: 'large',
  },

  // 12 plan agents (prerequisites: ['scenario-planning'])
  'navigation-plan': { name: 'navigation-plan', displayName: 'Navigation Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-navigation', deliverableFilename: 'navigation_plan_deliverable.md' },
  'forms-plan': { name: 'forms-plan', displayName: 'Forms Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-forms', deliverableFilename: 'forms_plan_deliverable.md' },
  'auth-plan': { name: 'auth-plan', displayName: 'Auth Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-auth', deliverableFilename: 'auth_plan_deliverable.md' },
  'authz-plan': { name: 'authz-plan', displayName: 'Authz Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-authz', deliverableFilename: 'authz_plan_deliverable.md' },
  'data-plan': { name: 'data-plan', displayName: 'Data Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-data', deliverableFilename: 'data_plan_deliverable.md' },
  'uiux-plan': { name: 'uiux-plan', displayName: 'UI/UX Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-uiux', deliverableFilename: 'uiux_plan_deliverable.md' },
  'api-plan': { name: 'api-plan', displayName: 'API Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-api', deliverableFilename: 'api_plan_deliverable.md' },
  'crossbrowser-plan': { name: 'crossbrowser-plan', displayName: 'Cross-Browser Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-crossbrowser', deliverableFilename: 'crossbrowser_plan_deliverable.md' },
  'a11y-plan': { name: 'a11y-plan', displayName: 'Accessibility Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-a11y', deliverableFilename: 'a11y_plan_deliverable.md' },
  'performance-plan': { name: 'performance-plan', displayName: 'Performance Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-performance', deliverableFilename: 'performance_plan_deliverable.md' },
  'errors-plan': { name: 'errors-plan', displayName: 'Error Handling Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-errors', deliverableFilename: 'errors_plan_deliverable.md' },
  'e2e-plan': { name: 'e2e-plan', displayName: 'E2E Plan agent', prerequisites: ['scenario-planning'], promptTemplate: 'plan-e2e', deliverableFilename: 'e2e_plan_deliverable.md' },

  // 12 exec agents (prerequisites: corresponding plan agent)
  'navigation-exec': { name: 'navigation-exec', displayName: 'Navigation Exec agent', prerequisites: ['navigation-plan'], promptTemplate: 'exec-navigation', deliverableFilename: 'navigation_exec_deliverable.md' },
  'forms-exec': { name: 'forms-exec', displayName: 'Forms Exec agent', prerequisites: ['forms-plan'], promptTemplate: 'exec-forms', deliverableFilename: 'forms_exec_deliverable.md' },
  'auth-exec': { name: 'auth-exec', displayName: 'Auth Exec agent', prerequisites: ['auth-plan'], promptTemplate: 'exec-auth', deliverableFilename: 'auth_exec_deliverable.md' },
  'authz-exec': { name: 'authz-exec', displayName: 'Authz Exec agent', prerequisites: ['authz-plan'], promptTemplate: 'exec-authz', deliverableFilename: 'authz_exec_deliverable.md' },
  'data-exec': { name: 'data-exec', displayName: 'Data Exec agent', prerequisites: ['data-plan'], promptTemplate: 'exec-data', deliverableFilename: 'data_exec_deliverable.md' },
  'uiux-exec': { name: 'uiux-exec', displayName: 'UI/UX Exec agent', prerequisites: ['uiux-plan'], promptTemplate: 'exec-uiux', deliverableFilename: 'uiux_exec_deliverable.md' },
  'api-exec': { name: 'api-exec', displayName: 'API Exec agent', prerequisites: ['api-plan'], promptTemplate: 'exec-api', deliverableFilename: 'api_exec_deliverable.md' },
  'crossbrowser-exec': { name: 'crossbrowser-exec', displayName: 'Cross-Browser Exec agent', prerequisites: ['crossbrowser-plan'], promptTemplate: 'exec-crossbrowser', deliverableFilename: 'crossbrowser_exec_deliverable.md' },
  'a11y-exec': { name: 'a11y-exec', displayName: 'Accessibility Exec agent', prerequisites: ['a11y-plan'], promptTemplate: 'exec-a11y', deliverableFilename: 'a11y_exec_deliverable.md' },
  'performance-exec': { name: 'performance-exec', displayName: 'Performance Exec agent', prerequisites: ['performance-plan'], promptTemplate: 'exec-performance', deliverableFilename: 'performance_exec_deliverable.md' },
  'errors-exec': { name: 'errors-exec', displayName: 'Error Handling Exec agent', prerequisites: ['errors-plan'], promptTemplate: 'exec-errors', deliverableFilename: 'errors_exec_deliverable.md' },
  'e2e-exec': { name: 'e2e-exec', displayName: 'E2E Exec agent', prerequisites: ['e2e-plan'], promptTemplate: 'exec-e2e', deliverableFilename: 'e2e_exec_deliverable.md' },

  // Multi-persona pipeline (sequential)
  'multi-persona-setup': { name: 'multi-persona-setup', displayName: 'Multi-Persona Setup agent', prerequisites: ['scenario-planning'], promptTemplate: 'multi-persona-setup', deliverableFilename: 'multi_persona_credentials.json' },
  'multi-persona-record': { name: 'multi-persona-record', displayName: 'Multi-Persona Record agent', prerequisites: ['multi-persona-setup'], promptTemplate: 'multi-persona-record', deliverableFilename: 'multi_persona_journey_map.json' },
  'multi-persona-replay': { name: 'multi-persona-replay', displayName: 'Multi-Persona Replay agent', prerequisites: ['multi-persona-record'], promptTemplate: 'multi-persona-replay', deliverableFilename: 'multi_persona_replay_results.json' },
  'multi-persona-analysis': { name: 'multi-persona-analysis', displayName: 'Multi-Persona Analysis agent', prerequisites: ['multi-persona-replay'], promptTemplate: 'multi-persona-analysis', deliverableFilename: 'multi_persona_analysis_deliverable.md' },

  // Report
  'report': {
    name: 'report',
    displayName: 'Report agent',
    prerequisites: ['navigation-exec', 'forms-exec', 'auth-exec', 'authz-exec', 'data-exec', 'uiux-exec', 'api-exec', 'crossbrowser-exec', 'a11y-exec', 'performance-exec', 'errors-exec', 'e2e-exec'],
    promptTemplate: 'report',
    deliverableFilename: 'uat_report.md',
    modelTier: 'small',
  },
});

// MCP agent mapping - assigns each agent to a specific Playwright instance to prevent conflicts
// Keys are promptTemplate values from AGENTS registry
// 12 instances shared by plan/exec pairs
export const MCP_AGENT_MAPPING: Record<string, PlaywrightAgent> = Object.freeze({
  // Phase 1: Discovery
  'discovery': 'playwright-agent1',

  // Phase 2: Scenario Planning
  'scenario-planning': 'playwright-agent2',

  // Phase 3-4: Plan/Exec pairs (shared Playwright instances)
  'plan-navigation': 'playwright-agent1', 'exec-navigation': 'playwright-agent1',
  'plan-forms': 'playwright-agent2', 'exec-forms': 'playwright-agent2',
  'plan-auth': 'playwright-agent3', 'exec-auth': 'playwright-agent3',
  'plan-authz': 'playwright-agent4', 'exec-authz': 'playwright-agent4',
  'plan-data': 'playwright-agent5', 'exec-data': 'playwright-agent5',
  'plan-uiux': 'playwright-agent6', 'exec-uiux': 'playwright-agent6',
  'plan-api': 'playwright-agent7', 'exec-api': 'playwright-agent7',
  'plan-crossbrowser': 'playwright-agent8', 'exec-crossbrowser': 'playwright-agent8',
  'plan-a11y': 'playwright-agent9', 'exec-a11y': 'playwright-agent9',
  'plan-performance': 'playwright-agent10', 'exec-performance': 'playwright-agent10',
  'plan-errors': 'playwright-agent11', 'exec-errors': 'playwright-agent11',
  'plan-e2e': 'playwright-agent12', 'exec-e2e': 'playwright-agent12',

  // Multi-persona pipeline (sequential, can share MCP servers)
  'multi-persona-setup': 'playwright-agent1',
  'multi-persona-record': 'playwright-agent1',
  'multi-persona-replay': 'playwright-agent1',
  'multi-persona-analysis': 'playwright-agent1',

  // Phase 6: Reporting
  'report': 'playwright-agent3',
});

// Factory function for plan queue validators
function createPlanValidator(testCategory: TestCategory): AgentValidator {
  return async (sourceDir: string, logger: ActivityLogger): Promise<boolean> => {
    try {
      await validateQueueAndDeliverable(testCategory, sourceDir);
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Queue validation failed for ${testCategory}: ${errMsg}`);
      return false;
    }
  };
}

// Factory function for exec deliverable validators
function createExecValidator(testCategory: TestCategory): AgentValidator {
  return async (sourceDir: string): Promise<boolean> => {
    const execFile = path.join(sourceDir, 'deliverables', `${testCategory}_exec_deliverable.md`);
    return await fs.pathExists(execFile);
  };
}

// Direct agent-to-validator mapping - much simpler than pattern matching
export const AGENT_VALIDATORS: Record<AgentName, AgentValidator> = Object.freeze({
  // Discovery agent - validates the discovery deliverable
  'discovery': async (sourceDir: string): Promise<boolean> => {
    const discoveryFile = path.join(sourceDir, 'deliverables', 'discovery_deliverable.md');
    return await fs.pathExists(discoveryFile);
  },

  // Scenario Planning agent
  'scenario-planning': async (sourceDir: string): Promise<boolean> => {
    const scenarioFile = path.join(sourceDir, 'deliverables', 'scenario_planning_deliverable.md');
    return await fs.pathExists(scenarioFile);
  },

  // Plan agents
  'navigation-plan': createPlanValidator('navigation'),
  'forms-plan': createPlanValidator('forms'),
  'auth-plan': createPlanValidator('auth'),
  'authz-plan': createPlanValidator('authz'),
  'data-plan': createPlanValidator('data'),
  'uiux-plan': createPlanValidator('uiux'),
  'api-plan': createPlanValidator('api'),
  'crossbrowser-plan': createPlanValidator('crossbrowser'),
  'a11y-plan': createPlanValidator('a11y'),
  'performance-plan': createPlanValidator('performance'),
  'errors-plan': createPlanValidator('errors'),
  'e2e-plan': createPlanValidator('e2e'),

  // Exec agents
  'navigation-exec': createExecValidator('navigation'),
  'forms-exec': createExecValidator('forms'),
  'auth-exec': createExecValidator('auth'),
  'authz-exec': createExecValidator('authz'),
  'data-exec': createExecValidator('data'),
  'uiux-exec': createExecValidator('uiux'),
  'api-exec': createExecValidator('api'),
  'crossbrowser-exec': createExecValidator('crossbrowser'),
  'a11y-exec': createExecValidator('a11y'),
  'performance-exec': createExecValidator('performance'),
  'errors-exec': createExecValidator('errors'),
  'e2e-exec': createExecValidator('e2e'),

  // Multi-persona agents
  'multi-persona-setup': async (sourceDir: string): Promise<boolean> => {
    const credentialsFile = path.join(sourceDir, 'deliverables', 'multi_persona_credentials.json');
    return await fs.pathExists(credentialsFile);
  },
  'multi-persona-record': async (sourceDir: string): Promise<boolean> => {
    const journeyMapFile = path.join(sourceDir, 'deliverables', 'multi_persona_journey_map.json');
    return await fs.pathExists(journeyMapFile);
  },
  'multi-persona-replay': async (sourceDir: string): Promise<boolean> => {
    const replayResultsFile = path.join(sourceDir, 'deliverables', 'multi_persona_replay_results.json');
    return await fs.pathExists(replayResultsFile);
  },
  'multi-persona-analysis': async (sourceDir: string): Promise<boolean> => {
    const analysisFile = path.join(sourceDir, 'deliverables', 'multi_persona_analysis_deliverable.md');
    return await fs.pathExists(analysisFile);
  },

  // Report agent
  'report': async (sourceDir: string, logger: ActivityLogger): Promise<boolean> => {
    const reportFile = path.join(
      sourceDir,
      'deliverables',
      'uat_report.md'
    );

    const reportExists = await fs.pathExists(reportFile);

    if (!reportExists) {
      logger.error('Missing required deliverable: uat_report.md');
    }

    return reportExists;
  },
});
