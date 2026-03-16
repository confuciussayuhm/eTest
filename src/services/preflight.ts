/**
 * Preflight validation checks
 */

import { Result, ok, err } from '../types/result.js';
import { UATError } from './error-handling.js';
import { ErrorCode } from '../types/errors.js';
import { parseConfig } from '../config-parser.js';
import { ensureValidToken } from '../utils/token-refresh.js';
import type { ActivityLogger } from '../types/activity-logger.js';

export async function runPreflightChecks(
  configPath: string | undefined,
  logger: ActivityLogger
): Promise<Result<void, UATError>> {
  // 1. Validate config if provided
  if (configPath) {
    try {
      await parseConfig(configPath);
      logger.info('Config validation passed');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return err(new UATError(
        `Config validation failed: ${msg}`,
        'config', false,
        { configPath, originalError: msg },
        ErrorCode.CONFIG_VALIDATION_FAILED
      ));
    }
  }

  // 2. Ensure OAuth token is valid (refreshes from credentials file if expired)
  try {
    await ensureValidToken();
  } catch {
    // Log but don't fail — env vars may still be set directly
  }

  // 3. Validate API credentials
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOauth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const hasBedrock = process.env.CLAUDE_CODE_USE_BEDROCK === '1';
  const hasVertex = process.env.CLAUDE_CODE_USE_VERTEX === '1';

  if (!hasApiKey && !hasOauth && !hasBedrock && !hasVertex) {
    return err(new UATError(
      'No API credentials configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN',
      'config', false, {},
      ErrorCode.AUTH_FAILED
    ));
  }

  return ok(undefined);
}
