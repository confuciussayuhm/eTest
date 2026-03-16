/**
 * Git Manager - checkpoints, commits, rollbacks
 */

import { $ } from 'zx';
import type { ActivityLogger } from '../types/activity-logger.js';

$.quiet = true;

export async function createGitCheckpoint(
  repoPath: string,
  agentName: string,
  attemptNumber: number,
  logger: ActivityLogger
): Promise<void> {
  try {
    await $`git -C ${repoPath} add -A`;
    await $`git -C ${repoPath} commit --allow-empty -m ${'checkpoint: ' + agentName + ' attempt ' + attemptNumber}`;
    logger.info(`Git checkpoint created for ${agentName} attempt ${attemptNumber}`);
  } catch (error) {
    logger.warn(`Git checkpoint failed (non-fatal): ${error}`);
  }
}

export async function commitGitSuccess(
  repoPath: string,
  agentName: string,
  logger: ActivityLogger
): Promise<void> {
  try {
    await $`git -C ${repoPath} add -A`;
    await $`git -C ${repoPath} commit --allow-empty -m ${'success: ' + agentName + ' completed'}`;
    logger.info(`Git success commit for ${agentName}`);
  } catch (error) {
    logger.warn(`Git commit failed (non-fatal): ${error}`);
  }
}

export async function rollbackGitWorkspace(
  repoPath: string,
  reason: string,
  logger: ActivityLogger
): Promise<void> {
  try {
    await $`git -C ${repoPath} checkout -- .`;
    await $`git -C ${repoPath} clean -fd`;
    logger.info(`Git rollback for: ${reason}`);
  } catch (error) {
    logger.warn(`Git rollback failed (non-fatal): ${error}`);
  }
}

export async function getGitCommitHash(repoPath: string): Promise<string | null> {
  try {
    const result = await $`git -C ${repoPath} rev-parse HEAD`;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export async function executeGitCommandWithRetry(
  args: string[],
  cwd: string,
  _description: string
): Promise<{ stdout: string }> {
  const result = await $`git -C ${cwd} ${args}`;
  return { stdout: result.stdout };
}
