/**
 * Temporal Worker for the eTest UAT pipeline.
 *
 * Bundles workflow code and registers all activities, then connects
 * to the Temporal server and starts polling the 'etest-pipeline'
 * task queue.
 */

import { NativeConnection, Worker, bundleWorkflowCode } from '@temporalio/worker';
import * as activities from './activities.js';

const TASK_QUEUE = 'etest-pipeline';

async function run(): Promise<void> {
  // Bundle workflow code for the sandbox (V8 isolate)
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
  });

  // Connect to the Temporal server (defaults to localhost:7233)
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowBundle,
    activities,
    maxConcurrentActivityTaskExecutions: 25,
  });

  console.log(`eTest worker started on task queue: ${TASK_QUEUE}`);
  await worker.run();
}

run().catch((err) => {
  console.error('eTest worker failed:', err);
  process.exit(1);
});
