/**
 * Temporal Client for the Testicles UAT pipeline.
 *
 * Parses CLI arguments, connects to the Temporal server, and starts
 * the uatPipelineWorkflow.  Optionally waits for the result.
 *
 * Usage:
 *   npx tsx src/temporal/client.ts <webUrl> [options]
 *
 * Options:
 *   --config <path>              Path to YAML/JSON config file
 *   --output <path>              Output directory for audit logs and deliverables
 *   --tests <categories>         Comma-separated test categories to run
 *   --regression                 Enable regression mode (skip discovery/planning)
 *   --pipeline-testing           Enable pipeline testing mode (reduced budgets)
 *   --workspace <name>           Resume from a previous workspace
 *   --workflow-id <id>           Custom workflow ID
 *   --wait                       Wait for the workflow to complete
 */

import { Connection, Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { hostname } from 'os';
import { parseArgs } from 'util';

import { displaySplashScreen } from '../splash-screen.js';
import { parseConfig } from '../config-parser.js';
import type { PipelineInput, PipelineState } from './shared.js';
import type { TestCategory } from '../types/agents.js';
import { formatWorkflowError } from './workflow-errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_QUEUE = 'testicles-pipeline';
const WORKFLOW_NAME = 'uatPipelineWorkflow';

const VALID_TEST_CATEGORIES: readonly TestCategory[] = [
  'navigation',
  'forms',
  'auth',
  'authz',
  'data',
  'uiux',
  'api',
  'crossbrowser',
  'a11y',
  'performance',
  'errors',
  'e2e',
] as const;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  webUrl: string;
  config?: string | undefined;
  output?: string | undefined;
  tests?: TestCategory[] | undefined;
  regression: boolean;
  pipelineTesting: boolean;
  workspace?: string | undefined;
  workflowId: string;
  wait: boolean;
}

function parseCliArgs(args: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      tests: { type: 'string' },
      regression: { type: 'boolean', default: false },
      'pipeline-testing': { type: 'boolean', default: false },
      workspace: { type: 'string' },
      'workflow-id': { type: 'string' },
      wait: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const webUrl = positionals[0];
  if (!webUrl) {
    console.error('Usage: client.ts <webUrl> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --config <path>              Path to YAML/JSON config file');
    console.error('  --output <path>              Output directory for audit logs');
    console.error('  --tests <categories>         Comma-separated test categories');
    console.error('  --regression                 Enable regression mode');
    console.error('  --pipeline-testing           Enable pipeline testing mode');
    console.error('  --workspace <name>           Resume from a previous workspace');
    console.error('  --workflow-id <id>           Custom workflow ID');
    console.error('  --wait                       Wait for the workflow to complete');
    console.error('');
    console.error(`Valid test categories: ${VALID_TEST_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  // Parse and validate test categories
  let tests: TestCategory[] | undefined;
  if (values.tests) {
    const requested = values.tests.split(',').map((t) => t.trim().toLowerCase());
    const invalid = requested.filter(
      (t) => !VALID_TEST_CATEGORIES.includes(t as TestCategory),
    );
    if (invalid.length > 0) {
      console.error(`Invalid test categories: ${invalid.join(', ')}`);
      console.error(`Valid categories: ${VALID_TEST_CATEGORIES.join(', ')}`);
      process.exit(1);
    }
    tests = requested as TestCategory[];
  }

  const workflowId =
    values['workflow-id'] ??
    `${hostname()}_testicles-${Date.now()}`;

  return {
    webUrl,
    config: values.config,
    output: values.output,
    tests,
    regression: values.regression ?? false,
    pipelineTesting: values['pipeline-testing'] ?? false,
    workspace: values.workspace,
    workflowId,
    wait: values.wait ?? false,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await displaySplashScreen();

  const cliArgs = parseCliArgs(process.argv.slice(2));

  // Optionally validate config up front
  if (cliArgs.config) {
    console.log(`Validating config: ${cliArgs.config}`);
    await parseConfig(cliArgs.config);
    console.log('Config validation passed.');
  }

  // Build pipeline input
  const sessionId = `session-${Date.now()}`;

  const pipelineInput: PipelineInput = {
    webUrl: cliArgs.webUrl,
    configPath: cliArgs.config,
    outputPath: cliArgs.output,
    pipelineTestingMode: cliArgs.pipelineTesting || undefined,
    regressionMode: cliArgs.regression || undefined,
    workflowId: cliArgs.workflowId,
    sessionId,
    tests: cliArgs.tests,
    ...(cliArgs.workspace && { resumeFromWorkspace: cliArgs.workspace }),
  };

  // Connect to the Temporal server
  const connection = await Connection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });

  const client = new Client({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
  });

  console.log(`Starting workflow: ${cliArgs.workflowId}`);
  console.log(`  Target URL:  ${cliArgs.webUrl}`);
  console.log(`  Task queue:  ${TASK_QUEUE}`);
  console.log(`  Session ID:  ${sessionId}`);
  if (cliArgs.config) {
    console.log(`  Config:      ${cliArgs.config}`);
  }
  if (cliArgs.tests) {
    console.log(`  Tests:       ${cliArgs.tests.join(', ')}`);
  }
  if (cliArgs.regression) {
    console.log(`  Mode:        regression`);
  }
  if (cliArgs.pipelineTesting) {
    console.log(`  Mode:        pipeline-testing`);
  }
  if (cliArgs.workspace) {
    console.log(`  Resume from: ${cliArgs.workspace}`);
  }

  try {
    // Start the workflow
    const handle = await client.workflow.start(WORKFLOW_NAME, {
      args: [pipelineInput],
      taskQueue: TASK_QUEUE,
      workflowId: cliArgs.workflowId,
      workflowRunTimeout: '4h',
    });

    console.log(`\nWorkflow started: ${handle.workflowId}`);
    console.log(`  Run ID: ${handle.firstExecutionRunId}`);

    if (cliArgs.wait) {
      console.log('\nWaiting for workflow to complete...\n');

      try {
        const result: PipelineState = await handle.result();

        console.log(`\nWorkflow completed.`);
        console.log(`  Phase:            ${result.phase}`);
        console.log(`  Completed agents: ${result.completedAgents.length}`);
        console.log(`  Failed agents:    ${result.failedAgents.length}`);
        console.log(`  Total cost:       $${result.totalCostUsd.toFixed(4)}`);

        if (result.error) {
          console.error(`  Error: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        const formatted = formatWorkflowError(err);
        console.error('\n=== Pipeline Failed ===');
        console.error(`  Type:        ${formatted.type}`);
        console.error(`  Message:     ${formatted.message}`);
        console.error(`  Retryable:   ${formatted.retryable}`);
        console.error(`  Remediation: ${formatted.remediation}`);
        process.exit(1);
      }
    } else {
      console.log('\nWorkflow running in background. Use Temporal UI or CLI to monitor.');
      console.log(`  temporal workflow describe --workflow-id ${handle.workflowId}`);
    }
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      console.error(`Workflow ${cliArgs.workflowId} is already running.`);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('Client error:', err);
  process.exit(1);
});
