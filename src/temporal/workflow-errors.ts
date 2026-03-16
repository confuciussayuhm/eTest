/**
 * Workflow-level error formatting and unwrapping utilities
 * with UAT-specific remediation hints.
 */

import { ApplicationFailure } from '@temporalio/workflow';

// ---------------------------------------------------------------------------
// Error type → remediation hint (UAT context)
// ---------------------------------------------------------------------------

const REMEDIATION_HINTS: Record<string, string> = {
  AuthenticationError:
    'Check your ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN environment variable.',
  BillingError:
    'Your Anthropic account may have reached its spending cap. ' +
    'Visit https://console.anthropic.com/settings/billing to review limits.',
  ConfigurationError:
    'Verify the config YAML/JSON path is correct, the file is valid, ' +
    'and the target URL is reachable.',
  InvalidTargetError:
    'The target URL appears invalid. Ensure it starts with http:// or https:// ' +
    'and the host is reachable.',
  PermissionError:
    'The API key does not have the required permissions. ' +
    'Check organisation-level access controls.',
  ExecutionLimitError:
    'An agent exceeded its turn or budget limit. ' +
    'Consider splitting large test categories or increasing limits in pipeline config.',
  OutputValidationError:
    'An agent completed but its deliverable failed validation. ' +
    'This is usually transient -- the workflow will retry automatically.',
  RequestTooLargeError:
    'The prompt sent to the model was too large. ' +
    'Check that the target site does not produce excessively large page content.',
  TransientError:
    'A transient network or service error occurred. ' +
    'The workflow should retry automatically. If it persists, check connectivity.',
  RateLimitError:
    'API rate-limit reached. The workflow will back off and retry. ' +
    'If this keeps happening, reduce max_concurrent_pipelines.',
  InvalidRequestError:
    'The request to the model was malformed. ' +
    'This may indicate a bug in prompt construction -- please report it.',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormattedWorkflowError {
  type: string;
  message: string;
  remediation: string;
  retryable: boolean;
  raw: unknown;
}

/**
 * Format any error thrown inside a workflow into a structured object
 * with a human-readable remediation hint.
 */
export function formatWorkflowError(error: unknown): FormattedWorkflowError {
  const { type, message, retryable } = unwrapActivityError(error);
  const remediation =
    REMEDIATION_HINTS[type] ??
    'An unexpected error occurred. Check logs for details.';

  return { type, message, remediation, retryable, raw: error };
}

/**
 * Unwrap a Temporal ApplicationFailure (or nested cause chain) into a
 * flat { type, message, retryable } triple.
 */
export function unwrapActivityError(error: unknown): {
  type: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ApplicationFailure) {
    const errorType = error.type ?? 'TransientError';
    const message = error.message || 'Unknown error';
    const retryable = !error.nonRetryable;
    return { type: errorType, message, retryable };
  }

  if (error instanceof Error) {
    // Walk the cause chain
    if ('cause' in error && error.cause) {
      return unwrapActivityError(error.cause);
    }
    return { type: 'TransientError', message: error.message, retryable: true };
  }

  return {
    type: 'TransientError',
    message: String(error),
    retryable: true,
  };
}
