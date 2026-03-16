/**
 * Queue validation for test execution readiness
 */

import { fileExists } from '../utils/file-io.js';
import path from 'path';
import type { TestCategory } from '../types/agents.js';

export async function validateQueueAndDeliverable(
  testCategory: TestCategory,
  sourceDir: string
): Promise<void> {
  const planFile = path.join(sourceDir, 'deliverables', `${testCategory}_plan_deliverable.md`);
  const exists = await fileExists(planFile);
  if (!exists) {
    throw new Error(`Plan deliverable not found for ${testCategory}`);
  }
}
