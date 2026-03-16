import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { DeliverableType, DELIVERABLE_FILENAMES } from '../types/deliverables.js';
import { createToolResult } from '../types/tool-responses.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';

const ReadDeliverableInputSchema = z.object({
  deliverable_type: z.nativeEnum(DeliverableType).describe('Type of deliverable to read'),
});

function isPathContained(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

function createReadDeliverableHandler(targetDir: string) {
  return async function readDeliverable(args: z.infer<typeof ReadDeliverableInputSchema>) {
    try {
      const filename = DELIVERABLE_FILENAMES[args.deliverable_type];
      const filepath = path.join(targetDir, 'deliverables', filename);

      if (!isPathContained(targetDir, filepath)) {
        return createToolResult(createValidationError(
          'Path resolves outside allowed directory', false, { deliverableType: args.deliverable_type }
        ));
      }

      if (!fs.existsSync(filepath)) {
        return createToolResult(createValidationError(
          `Deliverable not found: ${filename}`, true, { deliverableType: args.deliverable_type }
        ));
      }

      const content = fs.readFileSync(filepath, 'utf-8');
      return createToolResult({
        status: 'success',
        message: `Read deliverable: ${filename}`,
        content,
        filepath,
        deliverableType: args.deliverable_type,
      });
    } catch (error) {
      return createToolResult(createGenericError(error, false, { deliverableType: args.deliverable_type }));
    }
  };
}

export function createReadDeliverableTool(targetDir: string) {
  return tool(
    'read_deliverable',
    'Reads a previously saved UAT deliverable file.',
    ReadDeliverableInputSchema.shape,
    createReadDeliverableHandler(targetDir)
  );
}
