/**
 * Audit System Utilities
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDirectory } from '../utils/file-io.js';

export type { SessionMetadata } from '../types/audit.js';
import type { SessionMetadata } from '../types/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT_LOGS_DIR = path.join(PROJECT_ROOT, 'audit-logs');

export function sanitizeHostname(url: string): string {
  return new URL(url).hostname.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function generateSessionIdentifier(sessionMetadata: SessionMetadata): string {
  return sessionMetadata.id;
}

export function generateAuditPath(sessionMetadata: SessionMetadata): string {
  const sessionIdentifier = generateSessionIdentifier(sessionMetadata);
  const baseDir = sessionMetadata.outputPath || AUDIT_LOGS_DIR;
  return path.join(baseDir, sessionIdentifier);
}

export function generateLogPath(sessionMetadata: SessionMetadata, agentName: string, timestamp: number, attemptNumber: number): string {
  const auditPath = generateAuditPath(sessionMetadata);
  return path.join(auditPath, 'agents', `${timestamp}_${agentName}_attempt-${attemptNumber}.log`);
}

export function generatePromptPath(sessionMetadata: SessionMetadata, agentName: string): string {
  return path.join(generateAuditPath(sessionMetadata), 'prompts', `${agentName}.md`);
}

export function generateSessionJsonPath(sessionMetadata: SessionMetadata): string {
  return path.join(generateAuditPath(sessionMetadata), 'session.json');
}

export function generateWorkflowLogPath(sessionMetadata: SessionMetadata): string {
  return path.join(generateAuditPath(sessionMetadata), 'workflow.log');
}

export async function initializeAuditStructure(sessionMetadata: SessionMetadata): Promise<void> {
  const auditPath = generateAuditPath(sessionMetadata);
  await ensureDirectory(auditPath);
  await ensureDirectory(path.join(auditPath, 'agents'));
  await ensureDirectory(path.join(auditPath, 'prompts'));
  await ensureDirectory(path.join(auditPath, 'deliverables'));
}

export async function copyDeliverablesToAudit(sessionMetadata: SessionMetadata, sourceDir: string): Promise<void> {
  const srcDir = path.join(sourceDir, 'deliverables');
  const destDir = path.join(generateAuditPath(sessionMetadata), 'deliverables');
  let entries: string[];
  try { entries = await fs.readdir(srcDir); } catch { return; }
  await ensureDirectory(destDir);
  for (const entry of entries) {
    const sourcePath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    const stat = await fs.stat(sourcePath);
    if (stat.isFile()) await fs.copyFile(sourcePath, destPath);
  }
}
