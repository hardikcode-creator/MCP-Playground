---
id: cli
title: The CLI
sidebar_label: 5. The CLI
sidebar_position: 6
description: Run any workflow headlessly - list tools, call a single tool, or execute a full workflow with pre-armed breakpoints and interactive controls.
---

# The CLI

The same engine that powers the UI also runs natively. The backend ships a
small CLI so workflows are reproducible from a terminal or a CI job - no browser
required. It takes an `mcp-config.json`, then a subcommand:

```bash
mcp-playground-backend <mcp-config.json> [subcommand] [...args]
```

## Why developers reach for the CLI

- **Local & private by default.** The Node engine has **no database and emits no
  telemetry** as its only runtime dependencies are the MCP SDK, `ws`, `zod`, and
  the Nutanix API clients. A run's data lives in
  memory and MCP servers are spawned as local child processes.
- **Observability.** The CLI enables workflow execution, live debugging, breakpoint management, and runtime inspection directly from the terminal.
- **Reproducibility & review.** It is the same `WorkflowExecutor` the UI
  uses, so a workflow proven on the canvas runs identically in a pipeline so there
  is no second implementation to drift out of sync.
- **Targeted debugging.** Use `call-tool` to exercise a single tool in isolation,
  or `list-tools` to inspect exactly what a config exposes.

## Subcommands

- **`list-tools`** (default) - spawn every server in the config and print the
  unified, namespaced tool catalog.
- **`call-tool <qualifiedName> [<jsonArgs>]`** - invoke a single tool once and
  print its result as JSON.
- **`run-workflow <workflowFile> [--break-at <nodeId>]...`** - load, validate,
  and run a workflow. `--break-at` can be repeated to **pre-arm** runtime
  breakpoints before the first node launches.

## Examples

```bash
# 1) List the catalog for a multi-server config
npm run dev -- ../examples/_shared_configs/mcp-config-multi.json list-tools

# 2) Call one tool directly
npm run dev -- ../examples/_shared_configs/mcp-config-multi.json \
  call-tool filesystem__list_directory '{"path":"/tmp"}'

# 3) Run a workflow (headless), pausing at one node
npm run dev -- ../examples/_shared_configs/mcp-config-multi.json \
  run-workflow ../examples/hello_world/workflow-hello.json --break-at greet
```

During a run, engine events stream to **stderr** as they happen, and the final
`WorkflowRunResult` is printed as JSON to **stdout** so you can pipe the result
into `jq` while still watching progress.

## Interactive controls

While `run-workflow` is executing, the controller reads stdin, so you can drive
the debugger live - even on nodes that are not paused yet:

| Command | Effect |
| --- | --- |
| `<Enter>` or `c` / `continue` | Resume the oldest paused node |
| `s` / `skip` | Resume the oldest paused node by skipping it |
| `bp <nodeId>` | Arm a runtime breakpoint (fires when that node runs) |
| `clear <nodeId>` | Remove a runtime breakpoint |
| `q` / `quit` / `cancel` | Cancel the workflow (same as Ctrl+C) |
| `?` / `help` | Reprint the command list |

Pauses are queued FIFO, because the engine permits **multiple concurrent
pauses** on parallel branches. Pressing Enter resumes the oldest still-paused
node.
