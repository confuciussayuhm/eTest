/**
 * Deliverable Type Definitions for Testicles UAT Framework
 *
 * Maps deliverable types to their filenames for UAT testing categories.
 * Each category has a _PLAN and _EXEC phase.
 */

export enum DeliverableType {
  // Discovery & planning
  DISCOVERY = 'DISCOVERY',
  SCENARIO_PLANNING = 'SCENARIO_PLANNING',

  // Navigation testing
  NAVIGATION_PLAN = 'NAVIGATION_PLAN',
  NAVIGATION_EXEC = 'NAVIGATION_EXEC',

  // Forms testing
  FORMS_PLAN = 'FORMS_PLAN',
  FORMS_EXEC = 'FORMS_EXEC',

  // Authentication testing
  AUTH_PLAN = 'AUTH_PLAN',
  AUTH_EXEC = 'AUTH_EXEC',

  // Authorization testing
  AUTHZ_PLAN = 'AUTHZ_PLAN',
  AUTHZ_EXEC = 'AUTHZ_EXEC',

  // Data integrity testing
  DATA_PLAN = 'DATA_PLAN',
  DATA_EXEC = 'DATA_EXEC',

  // UI/UX testing
  UIUX_PLAN = 'UIUX_PLAN',
  UIUX_EXEC = 'UIUX_EXEC',

  // API testing
  API_PLAN = 'API_PLAN',
  API_EXEC = 'API_EXEC',

  // Cross-browser testing
  CROSSBROWSER_PLAN = 'CROSSBROWSER_PLAN',
  CROSSBROWSER_EXEC = 'CROSSBROWSER_EXEC',

  // Accessibility testing
  A11Y_PLAN = 'A11Y_PLAN',
  A11Y_EXEC = 'A11Y_EXEC',

  // Performance testing
  PERFORMANCE_PLAN = 'PERFORMANCE_PLAN',
  PERFORMANCE_EXEC = 'PERFORMANCE_EXEC',

  // Error handling testing
  ERRORS_PLAN = 'ERRORS_PLAN',
  ERRORS_EXEC = 'ERRORS_EXEC',

  // End-to-end testing
  E2E_PLAN = 'E2E_PLAN',
  E2E_EXEC = 'E2E_EXEC',

  // Multi-persona testing
  MULTI_PERSONA_CREDENTIALS = 'MULTI_PERSONA_CREDENTIALS',
  MULTI_PERSONA_JOURNEY_MAP = 'MULTI_PERSONA_JOURNEY_MAP',
  MULTI_PERSONA_REPLAY_RESULTS = 'MULTI_PERSONA_REPLAY_RESULTS',
  MULTI_PERSONA_ANALYSIS = 'MULTI_PERSONA_ANALYSIS',

  // Final report
  UAT_REPORT = 'UAT_REPORT',
}

/**
 * Hard-coded filename mappings for UAT deliverables.
 * Each category has a _plan and _exec deliverable file.
 */
export const DELIVERABLE_FILENAMES: Record<DeliverableType, string> = {
  // Discovery & planning
  [DeliverableType.DISCOVERY]: 'discovery_deliverable.md',
  [DeliverableType.SCENARIO_PLANNING]: 'scenario_planning_deliverable.md',

  // Navigation testing
  [DeliverableType.NAVIGATION_PLAN]: 'navigation_plan_deliverable.md',
  [DeliverableType.NAVIGATION_EXEC]: 'navigation_exec_deliverable.md',

  // Forms testing
  [DeliverableType.FORMS_PLAN]: 'forms_plan_deliverable.md',
  [DeliverableType.FORMS_EXEC]: 'forms_exec_deliverable.md',

  // Authentication testing
  [DeliverableType.AUTH_PLAN]: 'auth_plan_deliverable.md',
  [DeliverableType.AUTH_EXEC]: 'auth_exec_deliverable.md',

  // Authorization testing
  [DeliverableType.AUTHZ_PLAN]: 'authz_plan_deliverable.md',
  [DeliverableType.AUTHZ_EXEC]: 'authz_exec_deliverable.md',

  // Data integrity testing
  [DeliverableType.DATA_PLAN]: 'data_plan_deliverable.md',
  [DeliverableType.DATA_EXEC]: 'data_exec_deliverable.md',

  // UI/UX testing
  [DeliverableType.UIUX_PLAN]: 'uiux_plan_deliverable.md',
  [DeliverableType.UIUX_EXEC]: 'uiux_exec_deliverable.md',

  // API testing
  [DeliverableType.API_PLAN]: 'api_plan_deliverable.md',
  [DeliverableType.API_EXEC]: 'api_exec_deliverable.md',

  // Cross-browser testing
  [DeliverableType.CROSSBROWSER_PLAN]: 'crossbrowser_plan_deliverable.md',
  [DeliverableType.CROSSBROWSER_EXEC]: 'crossbrowser_exec_deliverable.md',

  // Accessibility testing
  [DeliverableType.A11Y_PLAN]: 'a11y_plan_deliverable.md',
  [DeliverableType.A11Y_EXEC]: 'a11y_exec_deliverable.md',

  // Performance testing
  [DeliverableType.PERFORMANCE_PLAN]: 'performance_plan_deliverable.md',
  [DeliverableType.PERFORMANCE_EXEC]: 'performance_exec_deliverable.md',

  // Error handling testing
  [DeliverableType.ERRORS_PLAN]: 'errors_plan_deliverable.md',
  [DeliverableType.ERRORS_EXEC]: 'errors_exec_deliverable.md',

  // End-to-end testing
  [DeliverableType.E2E_PLAN]: 'e2e_plan_deliverable.md',
  [DeliverableType.E2E_EXEC]: 'e2e_exec_deliverable.md',

  // Multi-persona testing
  [DeliverableType.MULTI_PERSONA_CREDENTIALS]: 'multi_persona_credentials.json',
  [DeliverableType.MULTI_PERSONA_JOURNEY_MAP]: 'multi_persona_journey_map.json',
  [DeliverableType.MULTI_PERSONA_REPLAY_RESULTS]: 'multi_persona_replay_results.json',
  [DeliverableType.MULTI_PERSONA_ANALYSIS]: 'multi_persona_analysis_deliverable.md',

  // Final report
  [DeliverableType.UAT_REPORT]: 'uat_report_deliverable.md',
};

/**
 * Type guard to check if a deliverable type is a queue type.
 * UAT has no exploitation queues, so this always returns false.
 * Kept for API compatibility with the save-deliverable tool pattern.
 */
export function isQueueType(_type: string): boolean {
  return false;
}
