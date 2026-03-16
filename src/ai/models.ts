/**
 * AI Model Configuration
 *
 * Model tier definitions and resolution logic for Claude API usage.
 */

export type ModelTier = 'small' | 'medium' | 'large';

export const DEFAULT_MODELS: Readonly<Record<ModelTier, string>> = Object.freeze({
  small: 'claude-haiku-4-5-20241022',
  medium: 'claude-sonnet-4-20250514',
  large: 'claude-opus-4-20250514',
});

/**
 * Resolve a model tier to a concrete model name.
 * Falls back to medium tier if the tier is unrecognized.
 */
export function resolveModel(tier: ModelTier | undefined): string {
  if (!tier) {
    return DEFAULT_MODELS.medium;
  }
  return DEFAULT_MODELS[tier] ?? DEFAULT_MODELS.medium;
}
