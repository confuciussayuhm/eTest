/**
 * Services Module
 */

export { Container, getOrCreateContainer, removeContainer } from './container.js';
export type { ContainerDependencies } from './container.js';
export { ConfigLoaderService } from './config-loader.js';
export { TestReadinessCheckerService } from './test-readiness-checker.js';
export { AgentExecutionService } from './agent-execution.js';
export type { AgentExecutionInput } from './agent-execution.js';
export { assembleFinalReport, injectModelIntoReport } from './reporting.js';
export { loadPrompt } from './prompt-manager.js';
