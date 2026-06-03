---
id: design-discussions
title: Design Discussions
sidebar_label: 9. Design Discussions
sidebar_position: 10
description: The system-design choices behind MCP Playground - one shared executor driving two front-ends, integration through small interfaces, JSON-as-config, composable cross-MCP workflows, and the language and framework picks that follow from them.
---

# Design Discussions

This section outlines the key architectural and engineering discussions behind MCP Playground. These choices prioritize modularity, observability, extensibility, and developer experience, forming the foundation for workflow orchestration, debugging, and execution across multiple MCP servers.

## Core Executor Engine

MCP Playground is built around a decoupled architecture that separates the execution engine from the interfaces that drive it. Whether workflows are triggered through a CLI, web UI, or WebSocket connection, all interactions pass through the same transport-agnostic execution core.

This separation allows the engine to focus solely on workflow orchestration, state management, breakpoint handling, and recovery, while frontend and transport layers remain thin, interchangeable adapters. The result is a flexible, observable, and extensible platform for building and debugging cross-MCP workflows.

The center of the system is a single component: the `WorkflowExecutor` that
schedules the DAG, resolves `$ref` data flow, and handles breakpoints. It is agnostic to CLI and websockets connections.

```mermaid
flowchart TB
  subgraph fronts ["Front-end"]
    cli["CLI<br/>stdin controls · events to stderr"]
    web["Web app<br/>EngineEvent Interface emits events"]
  end
  subgraph core ["Executor Engine"]
    ex["WorkflowExecutor<br/>DAG scheduler · live breakpoints handling"]
  end
  cm["ClientManager<br/>MCP proxy"]

  cli -- "run · PauseHandler (continue / skip)" --> ex
  web -- "runWorkflow · pauseAction · setBreakpoint · cancel" --> ex
  ex -- "EngineEvent stream<br/>node.started / paused / completed / failed" --> cli
  ex -- "EngineEvent · WebSocket :8787" --> web
  ex -- "ToolCaller" --> cm
  ```

The executor reaches the outside world through just two tiny interfaces:
`ToolCaller` (how to call a tool) and `PauseHandler` (what to do when a node hits
a breakpoint). Everything else plugs into those seams:

- The **MCP proxy** (`ClientManager`) satisfies `ToolCaller`.
- The **CLI** supplies a stdin-driven `PauseHandler`; the **web app** supplies
  `WsPauseHandler`, which broadcasts the pause over the socket and awaits the
  user's action.

This is exactly what lets the **WebSocket layer** deliver a live debugger
on-the-fly breakpoints (set and cleared mid-run) and a streamed event feed
without the engine ever knowing a socket exists.


## JSON-Native Configuration

A run is defined by two JSON documents: `mcp-config.json` (which servers to
spawn) and `workflow.json` (the DAG). Both are ordinary JSON files which the user can easily import and export.

- **Portable and versionable.** They are easy to save, diff in git, share with a
  teammate, and export/import between the UI and the CLI.
- **Standard format.** The preferred `mcpServers` map matches Claude Desktop,
  Cursor, and `mcp-remote`, so existing server configs drop in unchanged (a
  legacy `servers` array is still accepted).
- **Validated at the boundary.** Both documents are parsed with `zod`, so a
  malformed config fails immediately with a readable message instead of a deep,
  confusing runtime crash.

**Why.** JSON is the lingua franca of the MCP ecosystem and of tooling in
general.

## Composable workflows across MCPs

A workflow is a **multi-layered, multi-nodal DAG** that can call tools from many
different MCP servers in one run - different tools, different MCP configs - all
reachable through one namespaced catalog, with data crossing server boundaries
via `$ref`. (The mechanics live in [Building Workflows](./building-workflows.mdx).)

**Why a DAG Instead of a Script?**
A DAG makes data flow explicit. Execution order, dependencies, and parallelism are derived from graph relationships rather than embedded in imperative control flow. The entire workflow remains visible, inspectable, and recoverable as a single artifact.

## Language and framework choices

Each pick follows from a concrete need, not familiarity:

| Area | Choice | Why this |
| --- | --- | --- |
| Backend / engine | **TypeScript on Node** | The official MCP SDK is TypeScript-first, allowing the backend and frontend to share a common type system. This eliminates duplicate models, improves type safety, and keeps the protocol contract consistent across the stack. |
| Validation | **`zod`** | User-supplied JSON (config, workflow, wire frames) is untrusted; `zod` validates it at the boundary and yields precise errors. |
| Transport | **`ws`** | Workflows are long-running and event-driven. WebSockets provide a persistent, low-latency channel for streaming execution updates, breakpoint events, logs, and state changes in real time without the overhead of repeated polling |
| Frontend | **React 19 + Vite + React Flow + Tailwind** | React Flow provides the foundation for a rich workflow canvas with native graph-editing capabilities. Vite delivers fast builds and rapid iteration, while Tailwind CSS ensures a consistent and scalable UI across the application. |
| Custom MCP | **Python + FastAPI + FastMCP, run via `uv`** | FastAPI serves as the source of truth for API contracts through OpenAPI specifications, FastMCP simplifies MCP tool development, and uv ensures a portable, zero-friction runtime experience for local development and deployment. |

## Architectural Principles

Several cross-cutting principles guide the architecture of MCP Playground:

- **Clear Separation of Responsibilities**
The proxy layer manages MCP server lifecycle and discovery, the execution engine orchestrates workflows and runtime state, and the UI focuses solely on authoring and visualization. Each layer can evolve independently without impacting the others.
- **Session-Level Isolation**
Every client connection is backed by an independent session with its own runtime context and MCP server instances. This guarantees isolation between users, browser tabs, and concurrent workflow executions.
- **Event-Driven Architecture**
Workflow execution is modeled as a stream of events. The engine emits execution events in real time, which are forwarded directly to connected clients, enabling live observability without polling.
- **Validated System Boundaries**
All external inputs including configurations, workflow definitions, and protocol messages are validated against schemas before entering the system, ensuring predictable behavior and reducing runtime errors.

```mermaid
flowchart TB
  subgraph uiL ["UI layer"]
    canvas["React Flow canvas + inspector"]
  end
  subgraph coreL ["Core layer (transport-agnostic)"]
    engine["Workflow engine"]
    proxy["MCP proxy / unified catalog"]
  end
  subgraph srvL ["Server layer (isolated processes)"]
    s1["MCP server"]
    s2["MCP server"]
    s3["custom MCP"]
  end
  canvas <-->|"JSON protocol over WS"| engine
  engine -->|"ToolCaller"| proxy
  proxy --> s1
  proxy --> s2
  proxy --> s3
```
