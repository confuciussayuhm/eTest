/**
 * Report assembly service
 */

import { fs, path } from 'zx';
import type { ActivityLogger } from '../types/activity-logger.js';

export async function assembleFinalReport(
  sourceDir: string,
  logger: ActivityLogger
): Promise<void> {
  const deliverablesDir = path.join(sourceDir, 'deliverables');
  if (!await fs.pathExists(deliverablesDir)) {
    logger.warn('No deliverables directory found');
    return;
  }

  const files = await fs.readdir(deliverablesDir);
  const evidenceFiles = files
    .filter((f: string) => f.endsWith('_exec_deliverable.md') || f.endsWith('_analysis_deliverable.md'))
    .sort();

  if (evidenceFiles.length === 0) {
    logger.warn('No evidence files found for report assembly');
    return;
  }

  let assembled = '# UAT Test Results - Assembled Evidence\n\n';
  for (const file of evidenceFiles) {
    const content = await fs.readFile(path.join(deliverablesDir, file), 'utf8');
    assembled += `\n---\n\n## ${file.replace(/_/g, ' ').replace('.md', '')}\n\n${content}\n`;
  }

  await fs.writeFile(path.join(deliverablesDir, 'assembled_test_results.md'), assembled);
  logger.info(`Assembled ${evidenceFiles.length} evidence files into report`);
}

export async function injectModelIntoReport(
  sourceDir: string,
  outputPath: string,
  logger: ActivityLogger
): Promise<void> {
  const reportPath = path.join(sourceDir, 'deliverables', 'uat_report.md');
  if (!await fs.pathExists(reportPath)) {
    logger.warn('No UAT report found to inject metadata');
    return;
  }

  try {
    const reportContent = await fs.readFile(reportPath, 'utf8');
    const destPath = path.join(outputPath, 'deliverables', 'uat_report.md');
    await fs.ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, reportContent);
    logger.info('Report copied to audit output');
  } catch (error) {
    logger.warn(`Failed to copy report: ${error}`);
  }
}
