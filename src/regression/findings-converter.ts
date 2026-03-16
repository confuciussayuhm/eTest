import type { RegressionTestCase } from '../types/config.js';
import type { TestCategory } from '../types/agents.js';
import { atomicWrite } from '../utils/file-io.js';
import { ensureDirectory } from '../utils/file-io.js';
import path from 'path';

/**
 * Groups regression test cases by their test_category and writes
 * plan deliverables that execution agents can run against.
 *
 * Returns the list of TestCategory values that had test cases.
 */
export async function populateRegressionTestCases(
  testCases: RegressionTestCase[],
  outputDir: string
): Promise<TestCategory[]> {
  // Group test cases by category
  const grouped = new Map<TestCategory, RegressionTestCase[]>();
  for (const tc of testCases) {
    const cat = tc.test_category as TestCategory;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(tc);
  }

  // Ensure the deliverables directory exists
  const deliverablesDir = path.join(outputDir, 'deliverables');
  await ensureDirectory(deliverablesDir);

  // Write plan deliverables for each category
  for (const [category, cases] of grouped) {
    const content = formatRegressionPlan(category, cases);
    await atomicWrite(
      path.join(deliverablesDir, `${category}_plan_deliverable.md`),
      content
    );
  }

  return [...grouped.keys()];
}

/**
 * Formats regression test cases into a markdown test plan deliverable
 * that execution agents can parse and run.
 */
function formatRegressionPlan(category: TestCategory, cases: RegressionTestCase[]): string {
  const lines: string[] = [];

  lines.push(`# Regression Test Plan: ${category}`);
  lines.push('');
  lines.push('> Auto-generated from regression configuration. Each test case below');
  lines.push('> corresponds to a previously identified issue that should be re-verified.');
  lines.push('');
  lines.push(`**Category:** ${category}`);
  lines.push(`**Total Test Cases:** ${cases.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const tc of cases) {
    lines.push(`## ${tc.id}: ${tc.title}`);
    lines.push('');
    lines.push(`- **Severity:** ${tc.severity}`);
    lines.push(`- **Category:** ${tc.test_category}`);
    lines.push('');
    lines.push('### Description');
    lines.push('');
    lines.push(tc.description);
    lines.push('');
    lines.push('### Steps');
    lines.push('');
    lines.push('1. Navigate to the relevant page/endpoint');
    lines.push('2. Reproduce the scenario described above');
    lines.push('3. Verify the issue is resolved or still present');
    lines.push('4. Document the actual behavior observed');
    lines.push('');
    lines.push('### Expected Result');
    lines.push('');
    lines.push(`The issue described in "${tc.title}" should be resolved.`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Re-export grouping utility for use in other modules.
 */
export function groupTestCasesByCategory(
  testCases: RegressionTestCase[]
): Map<TestCategory, RegressionTestCase[]> {
  const grouped = new Map<TestCategory, RegressionTestCase[]>();
  for (const tc of testCases) {
    const category = tc.test_category as TestCategory;
    const existing = grouped.get(category) || [];
    existing.push(tc);
    grouped.set(category, existing);
  }
  return grouped;
}
