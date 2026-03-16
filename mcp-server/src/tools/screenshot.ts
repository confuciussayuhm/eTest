import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createToolResult } from '../types/tool-responses.js';
import { createGenericError } from '../utils/error-formatter.js';

const ScreenshotInputSchema = z.object({
  name: z.string().min(1).describe('Name for the screenshot file (without extension)'),
  description: z.string().optional().describe('Description of what the screenshot shows'),
});

function createScreenshotHandler(targetDir: string) {
  return async function takeScreenshot(args: z.infer<typeof ScreenshotInputSchema>) {
    try {
      // Sanitize filename
      const safeName = args.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const screenshotDir = path.join(targetDir, 'screenshots');

      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const filepath = path.join(screenshotDir, `${safeName}.png`);

      return createToolResult({
        status: 'success',
        message: `Screenshot placeholder created: ${safeName}.png. Use Playwright's screenshot tool to capture the actual screenshot, then reference this path in your deliverable.`,
        filepath,
        name: safeName,
        description: args.description ?? '',
      });
    } catch (error) {
      return createToolResult(createGenericError(error, false, { name: args.name }));
    }
  };
}

export function createScreenshotTool(targetDir: string) {
  return tool(
    'take_screenshot',
    'Creates a screenshot placeholder entry. Use Playwright MCP browser_screenshot to capture actual screenshots.',
    ScreenshotInputSchema.shape,
    createScreenshotHandler(targetDir)
  );
}
