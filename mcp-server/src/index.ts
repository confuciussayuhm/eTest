/**
 * eTest Helper MCP Server
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createSaveDeliverableTool } from './tools/save-deliverable.js';
import { createReadDeliverableTool } from './tools/read-deliverable.js';
import { createScreenshotTool } from './tools/screenshot.js';

export function createETestHelperServer(targetDir: string): ReturnType<typeof createSdkMcpServer> {
  const saveDeliverableTool = createSaveDeliverableTool(targetDir);
  const readDeliverableTool = createReadDeliverableTool(targetDir);
  const screenshotTool = createScreenshotTool(targetDir);

  return createSdkMcpServer({
    name: 'etest-helper',
    version: '1.0.0',
    tools: [saveDeliverableTool, readDeliverableTool, screenshotTool],
  });
}

export { createSaveDeliverableTool } from './tools/save-deliverable.js';
export { createReadDeliverableTool } from './tools/read-deliverable.js';
export { createScreenshotTool } from './tools/screenshot.js';
export * from './types/index.js';
