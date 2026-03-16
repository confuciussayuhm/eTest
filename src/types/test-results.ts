/**
 * Test result types for UAT framework
 */

export type TestVerdict = 'pass' | 'fail' | 'skip' | 'blocked' | 'partial';

export interface TestEvidence {
  screenshotPath?: string;
  description: string;
  timestamp: string;
  url?: string;
}

export interface TestResult {
  id: string;
  title: string;
  category: string;
  verdict: TestVerdict;
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  evidence: TestEvidence[];
  duration_ms: number;
  acceptanceCriterionId?: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  partial: number;
  passRate: number;
  categories: Record<string, CategorySummary>;
}

export interface CategorySummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}
