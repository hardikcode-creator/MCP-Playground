import { ConfigValidationError, loadConfigFromFile } from './config.js';
import { CliRunController } from './cli/run-controller.js';
import { ClientManager } from './mcp/client-manager.js';
import type { EngineEvent } from './types/workflow.js';
import { CycleError } from './workflow/graph.js';
import { WorkflowExecutor } from './workflow/executor.js';
import { loadWorkflowFromFile, WorkflowValidationError } from './workflow/loader.js';
import type { StartResult } from './mcp/client-manager.js';

/**
 * If a workflow is mid-run when SIGINT arrives, we want Ctrl+C to CANCEL the
 * workflow (let it wind down through the executor's signal path) rather than
 * yank the manager out from under it. The signal handler set up in main()
 * dispatches based on whether this is currently non-null.
 *
 * Second SIGINT during cancellation falls through to manager.shutdown() and
 * a hard exit, so a stuck workflow can still be killed.
 */
let currentRunAbort: AbortController | null = null;

async function main(): Promise<void> {
  const [
    configPath,
    subcommand = 'list-tools',
    ...subcommandArgs
  ] = process.argv.slice(2);

  if (!configPath) {
    printUsage();
    process.exit(2);
  }

  let config;
  try {
    config = await loadConfigFromFile(configPath);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(err.message);
    } else {
      console.error(`Failed to load config: ${(err as Error).message}`);
    }
    process.exit(1);
  }

  console.error(
    `[mcp-playground] Loaded config with ${config.servers.length} server(s)`,
  );

  const manager = new ClientManager();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n[mcp-playground] Received ${signal}, shutting down...`);
    await manager.shutdown();
    process.exit(0);
  };

  const onSigint = () => {
    // If a workflow is currently running, the first Ctrl+C asks it to cancel
    // gracefully; the run() promise resolves, finally{} runs shutdown.
    if (currentRunAbort && !currentRunAbort.signal.aborted) {
      console.error(
        `\n[mcp-playground] Ctrl+C — cancelling workflow (press again to force-exit)…`,
      );
      currentRunAbort.abort();
      return;
    }
    void shutdown('SIGINT');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const startup = await manager.start(config);
  reportStartupIssues(startup);

  try {
    switch (subcommand) {
      case 'list-tools':
        runListTools(manager);
        break;
      case 'call-tool':
        await runCallTool(manager, subcommandArgs);
        break;
      case 'run-workflow':
        await runWorkflowCmd(manager, subcommandArgs);
        break;
      default:
        console.error(`\nUnknown subcommand: "${subcommand}"`);
        printUsage();
        process.exitCode = 2;
    }
  } catch (err) {
    console.error(`[mcp-playground] Fatal: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await manager.shutdown();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommand: list-tools  (default)
// ─────────────────────────────────────────────────────────────────────────────
function runListTools(manager: ClientManager): void {
  const catalog = manager.getCatalog();
  console.error(
    `\n[mcp-playground] Tool catalog (${catalog.length} total):\n`,
  );
  for (const tool of catalog) {
    console.error(`  ${tool.qualifiedName}`);
    if (tool.description) {
      console.error(`    ${tool.description}`);
    }
  }
  console.error('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommand: call-tool <qualifiedName> [<jsonArgs>]
// ─────────────────────────────────────────────────────────────────────────────
async function runCallTool(
  manager: ClientManager,
  args: string[],
): Promise<void> {
  const [toolName, argsJson = '{}'] = args;
  if (!toolName) {
    console.error('\nUsage: call-tool <qualifiedName> [<jsonArgs>]');
    console.error(
      `Example: call-tool filesystem__list_directory '{"path":"/tmp"}'`,
    );
    process.exitCode = 2;
    return;
  }

  let parsedArgs: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('args must be a JSON object');
    }
    parsedArgs = parsed as Record<string, unknown>;
  } catch (err) {
    console.error(`Invalid args JSON: ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }

  console.error(`\n[call-tool] ${toolName}`);
  console.error(`  args: ${JSON.stringify(parsedArgs)}`);
  const started = Date.now();
  try {
    const result = await manager.callTool(toolName, parsedArgs);
    const ms = Date.now() - started;
    console.error(`\n\n✓ done in ${ms}ms\n`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`  ✕ failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommand: run-workflow <workflowFile> [--break-at <nodeId>]...
//
// Loads + validates a workflow JSON and runs it interactively. Streams
// events to stderr as they happen; prints the final WorkflowRunResult to
// stdout as JSON.
//
// Interactive controls during the run (see CliRunController):
//   <Enter>            resume oldest paused node
//   bp <nodeId>        arm a runtime breakpoint
//   clear <nodeId>     remove a runtime breakpoint
//   q | quit | cancel  cancel the workflow
//   Ctrl+C             cancel the workflow (force-exit on second press)
//
// --break-at <nodeId> can be supplied repeatedly to PRE-ARM runtime
// breakpoints before the first node launches.
// ─────────────────────────────────────────────────────────────────────────────
async function runWorkflowCmd(
  manager: ClientManager,
  args: string[],
): Promise<void> {
  const parsed = parseRunWorkflowArgs(args);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const { workflowPath, preArmedBreakpoints } = parsed;

  let workflow;
  try {
    workflow = await loadWorkflowFromFile(workflowPath);
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      console.error(err.message);
    } else {
      console.error(`Failed to load workflow: ${(err as Error).message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.error(
    `\n\n\n[run-workflow] ${workflow.id}${
      workflow.name ? ` — ${workflow.name}` : ''
    } (${workflow.nodes.length} nodes)\n`,
  );

  const abortController = new AbortController();

  // The controller and the executor reference each other: the controller
  // forwards `bp <nodeId>` commands to executor.setBreakpoint, and the
  // executor calls back into the controller when a breakpoint fires. We
  // break the cycle by giving the controller a closure that captures
  // `executor` — assigned on the very next line.
  let executor: WorkflowExecutor;
  const controller = new CliRunController({
    abortController,
    setBreakpoint: (nodeId) => executor.setBreakpoint(nodeId),
    clearBreakpoint: (nodeId) => executor.clearBreakpoint(nodeId),
  });
  executor = new WorkflowExecutor(
    {
      call: (qualifiedName, callArgs, options) =>
        manager.callTool(qualifiedName, callArgs, options),
    },
    controller,
  );

  executor.on(printEvent);
  controller.printHelp();

  for (const nodeId of preArmedBreakpoints) {
    executor.setBreakpoint(nodeId);
  }

  currentRunAbort = abortController;
  try {
    const result = await executor.run(workflow, {
      signal: abortController.signal,
    });
    console.error('\n[run-workflow] summary:');
    console.error(`  status:   ${result.status}`);
    console.error(`  runId:    ${result.runId}`);
    console.error(`  duration: ${result.durationMs}ms`);
    console.error(`  steps:    ${result.steps.length}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'completed') process.exitCode = 1;
  } catch (err) {
    if (err instanceof CycleError) {
      console.error(`\n[run-workflow] ${err.message}`);
    } else {
      console.error(`\n[run-workflow] failed: ${(err as Error).message}`);
    }
    process.exitCode = 1;
  } finally {
    currentRunAbort = null;
    controller.dispose();
  }
}

type ParsedRunWorkflowArgs =
  | {
      ok: true;
      workflowPath: string;
      preArmedBreakpoints: string[];
    }
  | { ok: false; error: string };

function parseRunWorkflowArgs(args: string[]): ParsedRunWorkflowArgs {
  let workflowPath: string | undefined;
  const preArmedBreakpoints: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--break-at') {
      const nodeId = args[++i];
      if (!nodeId) {
        return { ok: false, error: '--break-at requires a node id' };
      }
      preArmedBreakpoints.push(nodeId);
      continue;
    }
    if (arg.startsWith('--')) {
      return { ok: false, error: `Unknown flag: ${arg}` };
    }
    if (workflowPath) {
      return {
        ok: false,
        error: `Unexpected extra positional argument: ${arg}`,
      };
    }
    workflowPath = arg;
  }

  if (!workflowPath) {
    return {
      ok: false,
      error:
        '\nUsage: run-workflow <path/to/workflow.json> [--break-at <nodeId>]...',
    };
  }
  return { ok: true, workflowPath, preArmedBreakpoints };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event printer — one place that knows how each EngineEvent looks on stderr.
// ─────────────────────────────────────────────────────────────────────────────
function printEvent(evt: EngineEvent): void {
  switch (evt.type) {
    case 'workflow.started':
      console.error(`  ▶ workflow.started  runId=${evt.runId}`);
      break;
    case 'node.ready':
      console.error(`  · ${evt.nodeId} ready`);
      break;
    case 'node.started':
      console.error(`  → ${evt.nodeId} → ${evt.tool}`);
      console.error(
        `      args (resolved): ${truncate(JSON.stringify(evt.resolvedArgs), 200)}`,
      );
      break;
    case 'node.paused':
      console.error(`  ⏸ ${evt.nodeId} paused (${evt.source} breakpoint)`);
      break;
    case 'node.resumed':
      console.error(`  ▶ ${evt.nodeId} resumed (${evt.action})`);
      break;
    case 'node.completed':
      console.error(`  ✓ ${evt.nodeId} done in ${evt.durationMs}ms`);
      break;
    case 'node.failed':
      console.error(
        `  ✕ ${evt.nodeId} failed in ${evt.durationMs}ms: ${evt.error}`,
      );
      break;
    case 'node.skipped':
      console.error(`  ⊘ ${evt.nodeId} skipped: ${evt.reason}`);
      break;
    case 'breakpoint.added':
      console.error(`  ● breakpoint armed on ${evt.nodeId}`);
      break;
    case 'breakpoint.cleared':
      console.error(`  ○ breakpoint cleared on ${evt.nodeId}`);
      break;
    case 'workflow.completed':
      console.error(
        `  ■ workflow.completed status=${evt.status} duration=${evt.durationMs}ms`,
      );
      break;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s;
}

function reportStartupIssues({ skipped, failed }: StartResult): void {
  if (skipped.length > 0) {
    console.error(
      `\n[mcp-playground] ${skipped.length} server(s) skipped due to missing required env vars:`,
    );
    for (const s of skipped) {
      console.error(`  - ${s.name}: needs ${s.missingEnv.join(', ')}`);
    }
    console.error(`\n  Set them in your shell and re-run, e.g.:`);
    for (const s of skipped) {
      console.error(
        `    ${s.missingEnv.map((v) => `${v}=...`).join(' ')} npm start -- <config>`,
      );
    }
  }

  if (failed.length > 0) {
    console.error(
      `\n[mcp-playground] ${failed.length} server(s) failed to connect:`,
    );
    for (const f of failed) console.error(`  - ${f.name}: ${f.error}`);
  }
}

function printUsage(): void {
  console.error('Usage:');
  console.error(
    '  mcp-playground-backend <mcp-config.json> [subcommand] [...args]',
  );
  console.error('');
  console.error('Subcommands:');
  console.error('  list-tools (default)                Print the tool catalog');
  console.error(
    '  call-tool   <qualifiedName> [<jsonArgs>]  Invoke a single tool',
  );
  console.error(
    '  run-workflow <workflowFile> [--break-at <nodeId>]...',
  );
  console.error('                                       Execute a workflow JSON file');
  console.error('');
  console.error('Examples:');
  console.error('  npm start -- ../examples/mcp-config.json');
  console.error(
    `  npm start -- ../examples/mcp-config.json call-tool filesystem__list_directory '{"path":"/tmp"}'`,
  );
  console.error(
    '  npm start -- ../examples/mcp-config.json run-workflow ../examples/workflow-hello.json',
  );
  console.error(
    '  npm start -- ../examples/mcp-config.json run-workflow ../examples/workflow-parallel.json --break-at branchA',
  );
}

main().catch((err) => {
  console.error('[mcp-playground] Fatal error:', err);
  process.exit(1);
});
