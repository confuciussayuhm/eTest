/**
 * Test Readiness Checker Service - mirrors Shannon's ExploitationCheckerService
 */

import type { TestCategory, ExecutionDecision } from '../types/agents.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import { fileExists } from '../utils/file-io.js';
import path from 'path';

export class TestReadinessCheckerService {
  async checkQueue(
    testCategory: TestCategory,
    sourceDir: string,
    logger: ActivityLogger
  ): Promise<ExecutionDecision> {
    const planFile = path.join(sourceDir, 'deliverables', `${testCategory}_plan_deliverable.md`);
    const exists = await fileExists(planFile);

    if (!exists) {
      logger.warn(`Plan deliverable not found for ${testCategory}, skipping execution`);
      return { shouldExecute: false, shouldRetry: false, testCaseCount: 0, testCategory };
    }

    logger.info(`Plan deliverable found for ${testCategory}, proceeding to execution`);
    return { shouldExecute: true, shouldRetry: false, testCaseCount: 1, testCategory };
  }
}
