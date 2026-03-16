/**
 * Consolidated billing/spending cap detection utilities.
 */

export const BILLING_TEXT_PATTERNS = [
  'spending cap',
  'spending limit',
  'cap reached',
  'budget exceeded',
  'usage limit',
  'resets',
] as const;

export const BILLING_API_PATTERNS = [
  'billing_error',
  'credit balance is too low',
  'insufficient credits',
  'usage is blocked due to insufficient credits',
  'please visit plans & billing',
  'please visit plans and billing',
  'usage limit reached',
  'quota exceeded',
  'daily rate limit',
  'limit will reset',
  'billing limit reached',
] as const;

export function matchesBillingTextPattern(text: string): boolean {
  const lowerText = text.toLowerCase();
  return BILLING_TEXT_PATTERNS.some((pattern) => lowerText.includes(pattern));
}

export function matchesBillingApiPattern(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return BILLING_API_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}

export function isSpendingCapBehavior(
  turns: number,
  cost: number,
  resultText: string
): boolean {
  if (turns > 2 || cost !== 0) {
    return false;
  }
  return matchesBillingTextPattern(resultText);
}
