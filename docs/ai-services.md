---
id: ai-services
title: "Smart Argument Mapping"
sidebar_label: 8. Smart Argument Mapping
sidebar_position: 9
description: An LLM-backed service that recommends $ref wirings from a node's input schema and upstream responses - running on a local Ollama model, choosing only from real, enumerated JSONPaths, with every suggested path re-validated against the actual response.
---
# Smart Argument Mapping
[Live references](./data-flow-references.mdx) already let you *pick* a path from
a response. The natural next step is to have the system **propose the whole
wiring for you**. That is what `ai-services/` does: given the node you are about
to run and the responses of its upstream nodes, it recommends which argument
should be wired to which key of which upstream result.
## How it works
```mermaid
flowchart TD
  cur["currentNode<br/>tool + description + input JSON Schema"] --> enum["enumerate concrete JSONPaths<br/>into each upstream response"]
  prev["previousNodes<br/>nodeId + tool + actual response"] --> enum
  enum --> llm["LLM (Ollama via OpenAI SDK)<br/>per-argument decision,<br/>picking only from the candidate paths"]
  llm --> dec{"decision"}
  dec -->|"reference"| ref["$ref { nodeId, path }"]
  dec -->|"literal"| lit["concrete value"]
  dec -->|"unmapped"| none["leave for the user"]
  ref --> val["validate the path actually resolves<br/>against the response"]
  val --> out["ArgumentMappingResult { tool, mappings, args }"]
  lit --> out
  none --> out
```
For each upstream node, the service walks its real response and pre-computes a
bounded, de-duplicated list of **concrete JSONPaths** (`enumeratePaths`: leaves
and the containers along the way, capped so a huge response can't blow up the
prompt). The model is handed that list and the downstream tool's input schema,
and its only job is to match each argument to the best candidate path - a
literal, or nothing. It produces exactly one decision per argument.
The returned `args` object is **directly compatible with the backend workflow
model** - a `reference` decision becomes `{ "$ref": { "nodeId", "path" } }`,
exactly the shape [the executor resolves](./data-flow-references.mdx). The
JSONPath grammar the service emits is a faithful subset of the backend's
(AI output mirrors backend's reference format), so any path it
suggests resolves identically inside the workflow engine.
## Key design choices
- **Runs against a local LLM (a hackathon constraint).** This was built during a
  hackathon where we needed guaranteed access to a model without a cloud key or
  quota, so the service targets a local **Ollama** instance rather than a hosted
  API. It talks to Ollama through its OpenAI-compatible API (`/v1`) with the
  official `openai` SDK, so pointing it at any other OpenAI-compatible endpoint
  (like NuChat or NAI endpoint) later is a config change, not a
  rewrite. Sensible defaults are built in (`gemma4`, temperature `0`);
  `OLLAMA_MODEL`, temperature, reasoning effort, and timeout are configurable via
  env, and JSON output is forced with `response_format: { type: 'json_object' }`.
- **Two-layer anti-hallucination guard.**
  1. *Constrain the choice.* The model is given the enumerated candidate paths
     and instructed to pick only from them, never inventing one. Biasing it
     toward a real, finite path list dramatically cuts hallucinated references
     (the next step is what actually enforces it).
  2. *Verify after the fact.* Every suggested `reference` path is still
     **re-resolved against the actual response** before being returned. Each
     mapping carries a `pathResolves` flag, so a path the model invented anyway
     - or a reference to an unknown node - is caught rather than silently wired
     in.
- **One decision per argument, always.** Post-processing guarantees exactly one
  mapping for every argument in the input schema. If the model says nothing about
  an argument, it comes back as `unmapped` rather than missing.
- **Explainable.** Each mapping includes a `decision`
  (`reference | literal | unmapped`), a `confidence`, and a one-line `reasoning`.
## Wiring into the Playground
The service runs as a small, dependency-free HTTP server (default
`http://localhost:5174`, via `npm run serve`):
- `GET /health` -> `{ "ok": true, "model": "<model>" }`
- `POST /suggest-mappings` -> body is the current node plus its upstream nodes
  (`ArgumentMappingInput`); response is the full `ArgumentMappingResult`.
  Invalid input returns `400`; an unreachable model or unusable output returns
  `502`.
On the frontend, the inspector's **"Auto-map with AI"** panel calls
`POST /suggest-mappings` (the boundary lives in `aiClient.ts`, pointed at the
service via `VITE_AI_URL`). It is deliberately conservative:
- It maps **only from the node's direct predecessors** - upstream nodes wired by
  an edge into the current node that have already produced a response. With no
  such node, the button is a no-op.
- Running it **auto-fills only still-empty fields**, so existing wiring is never
  clobbered, and it **never auto-applies a reference whose path didn't resolve**
  (`pathResolves === false`).
- Every suggestion is still listed with its confidence and reasoning, each with
  its own **Apply** button, so you can apply one explicitly - even over a filled
  field, or even when its path didn't resolve.
```bash
curl -s -X POST http://localhost:5174/suggest-mappings \
  -H 'Content-Type: application/json' \
  -d @examples/sample-mapping-input.json
```
```json
{
  "tool": "everything__echo",
  "mappings": [
    {
      "argument": "message",
      "decision": "reference",
      "ref": { "nodeId": "sum", "path": "$.content[0].text" },
      "confidence": 0.95,
      "reasoning": "Echo's text comes from the upstream result's text content.",
      "pathResolves": true
    }
  ],
  "args": { "message": { "$ref": { "nodeId": "sum", "path": "$.content[0].text" } } },
  "model": "llama3.1"
}
```
The `args` field is the ready-to-use part: drop it straight into the node and
the workflow engine resolves it like any hand-authored reference.
This closes the loop on the most error-prone part of authoring a multi-MCP
workflow - wiring data between tools - and does it **privately, on the
developer's own machine.**