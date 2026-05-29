import { ConfigValidationError, loadConfigFromFile } from './config.js';
import { ClientManager } from './mcp/client-manager.js';
import type { EngineEvent } from './types/workflow.js';
import { WorkflowValidationError } from './types/workflow.js';
import { CycleError } from './workflow/graph.js';
import { WorkflowExecutor } from './workflow/executor.js';
import { loadWorkflowFromFile } from './workflow/loader.js';

type StartupReport = {
  failed: { name: string; error: string }[];
  skipped: { name: string; missingEnv: string[] }[];
};

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
  process.on('SIGINT', () => void shutdown('SIGINT'));
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
// Prints the aggregated tool catalog and exits.
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
// Invokes a single tool. The full result envelope is printed to stdout as
// pretty JSON — exactly what the user needs to discover output shapes before
// writing a workflow that $refs into them.
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
    console.error(`  ✓ done in ${ms}ms\n`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`  ✕ failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommand: run-workflow <workflowFile>
// Loads + validates a workflow JSON and runs it end-to-end. Streams events
// to stderr as they happen; prints the final WorkflowRunResult to stdout
// as JSON (so it can be piped to jq, redirected to a file, etc.).
// ─────────────────────────────────────────────────────────────────────────────
async function runWorkflowCmd(
  manager: ClientManager,
  args: string[],
): Promise<void> {
  const [workflowPath] = args;
  if (!workflowPath) {
    console.error('\nUsage: run-workflow <path/to/workflow.json>');
    process.exitCode = 2;
    return;
  }

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
    `\n[run-workflow] ${workflow.id}${
      workflow.name ? ` — ${workflow.name}` : ''
    } (${workflow.nodes.length} nodes)\n`,
  );

  const executor = new WorkflowExecutor({
    call: (qualifiedName, callArgs) => manager.callTool(qualifiedName, callArgs),
  });
  executor.on(printEvent);

  try {
    const result = await executor.run(workflow);
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
  }
}

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

function reportStartupIssues({ skipped, failed }: StartupReport): void {
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
    '  run-workflow <workflowFile>          Execute a workflow JSON file',
  );
  console.error('');
  console.error('Examples:');
  console.error('  npm start -- ../examples/mcp-config.json');
  console.error(
    `  npm start -- ../examples/mcp-config.json call-tool filesystem__list_directory '{"path":"/tmp"}'`,
  );
  console.error(
    '  npm start -- ../examples/mcp-config.json run-workflow ../examples/workflow-hello.json',
  );
}

main().catch((err) => {
  console.error('[mcp-playground] Fatal error:', err);
  process.exit(1);
});
