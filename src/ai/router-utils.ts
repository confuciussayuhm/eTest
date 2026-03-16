/**
 * Router Utilities
 *
 * Maps model identifiers to actual API model names for routing purposes.
 */

const MODEL_NAME_MAP: Readonly<Record<string, string>> = Object.freeze({
  'claude-haiku-4-5-20241022': 'claude-haiku-4-5-20241022',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
  'haiku': 'claude-haiku-4-5-20241022',
  'sonnet': 'claude-sonnet-4-20250514',
  'opus': 'claude-opus-4-20250514',
});

/**
 * Get the actual API model name from a model identifier.
 * Returns the identifier as-is if no mapping is found.
 */
export function getActualModelName(modelIdentifier: string): string {
  return MODEL_NAME_MAP[modelIdentifier] ?? modelIdentifier;
}
