/**
 * Config Loader Service
 */

import { parseConfig, distributeConfig } from '../config-parser.js';
import { UATError } from './error-handling.js';
import { Result, ok, err } from '../types/result.js';
import { ErrorCode } from '../types/errors.js';
import type { DistributedConfig } from '../types/config.js';

export class ConfigLoaderService {
  async load(configPath: string): Promise<Result<DistributedConfig, UATError>> {
    try {
      const config = await parseConfig(configPath);
      const distributed = distributeConfig(config);
      return ok(distributed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      let errorCode = ErrorCode.CONFIG_PARSE_ERROR;
      if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
        errorCode = ErrorCode.CONFIG_NOT_FOUND;
      } else if (errorMessage.includes('validation failed')) {
        errorCode = ErrorCode.CONFIG_VALIDATION_FAILED;
      }
      return err(
        new UATError(
          `Failed to load config ${configPath}: ${errorMessage}`,
          'config', false,
          { configPath, originalError: errorMessage },
          errorCode
        )
      );
    }
  }

  async loadOptional(
    configPath: string | undefined
  ): Promise<Result<DistributedConfig | null, UATError>> {
    if (!configPath) return ok(null);
    return this.load(configPath);
  }
}
