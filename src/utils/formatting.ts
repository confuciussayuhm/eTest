/**
 * Formatting Utilities
 */

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatTimestamp(timestamp: number = Date.now()): string {
  return new Date(timestamp).toISOString();
}

export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

export function extractAgentType(description: string): string {
  if (description.includes('Discovery')) return 'discovery';
  if (description.includes('Scenario')) return 'scenario planning';
  if (description.includes('Report')) return 'report generation';
  if (description.includes('plan')) return 'test planning';
  if (description.includes('exec')) return 'test execution';
  return 'analysis';
}
