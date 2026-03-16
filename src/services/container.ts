/**
 * Dependency Injection Container
 */

import type { SessionMetadata } from '../types/audit.js';
import { AgentExecutionService } from './agent-execution.js';
import { ConfigLoaderService } from './config-loader.js';
import { TestReadinessCheckerService } from './test-readiness-checker.js';

export interface ContainerDependencies {
  readonly sessionMetadata: SessionMetadata;
}

export class Container {
  readonly sessionMetadata: SessionMetadata;
  readonly agentExecution: AgentExecutionService;
  readonly configLoader: ConfigLoaderService;
  readonly testReadinessChecker: TestReadinessCheckerService;

  constructor(deps: ContainerDependencies) {
    this.sessionMetadata = deps.sessionMetadata;
    this.configLoader = new ConfigLoaderService();
    this.testReadinessChecker = new TestReadinessCheckerService();
    this.agentExecution = new AgentExecutionService(this.configLoader);
  }
}

const containers = new Map<string, Container>();

export function getOrCreateContainer(
  workflowId: string,
  sessionMetadata: SessionMetadata
): Container {
  let container = containers.get(workflowId);
  if (!container) {
    container = new Container({ sessionMetadata });
    containers.set(workflowId, container);
  }
  return container;
}

export function removeContainer(workflowId: string): void {
  containers.delete(workflowId);
}

export function getContainer(workflowId: string): Container | undefined {
  return containers.get(workflowId);
}
