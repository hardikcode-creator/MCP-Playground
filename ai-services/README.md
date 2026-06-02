# ai-services

AI capabilities for the MCP Playground. The first capability is **argument
mapping**: given the node you're about to run and the response(s) of the
upstream node(s), it recommends which argument of the current node should be
wired to which key of an upstream response.

It powers the "Smart-mapping / Fill from upstream" feature described in the
project plan (Phase 2): turn a tool's docstring + input schema + an upstream
response into a one-click set of `$ref` wirings.

The LLM is a **local Ollama** model accessed through its OpenAI-compatible API
using the official `openai` SDK — no cloud key required.

## How it works

```
currentNode  (tool name + description + input JSON Schema)
previousNodes (nodeId + tool + description + actual response)
        │
        ▼
   enumerate concrete JSONPaths into each upstream response
        │
        ▼
   LLM (Ollama via OpenAI SDK)  ──►  per-argument decision
        │                            reference | literal | unmapped
        ▼
   validate each chosen path actually resolves against the response
        │
        ▼
   ArgumentMappingResult { mappings, args }
```

The returned `args` object is **directly compatible with the backend workflow
model** — `reference` decisions become `{ "$ref": { "nodeId", "path" } }`,
matching `backend/src/workflow/refs.ts` and `examples/workflow-hello.json`.

## Setup

1. Install and run Ollama, then pull a model:

```bash
ollama serve
ollama pull llama3.1
```

2. Install dependencies:

```bash
cd ai-services
npm install
```

3. Configure (optional — sensible Ollama defaults are built in):

```bash
cp .env.example .env
# edit OLLAMA_MODEL etc. if needed
```

## Try it

```bash
npm run demo                          # uses examples/sample-mapping-input.json
npm run demo -- path/to/input.json    # your own input
```

Example output for the bundled sample (echo a previous get-sum result):

```json
{
  "message": { "$ref": { "nodeId": "sum", "path": "$.content[0].text" } }
}
```

## HTTP server (used by the frontend)

The frontend's "Auto-map with AI" button calls this over HTTP. Start it with:

```bash
npm run serve         # listens on http://localhost:5174 (AI_HTTP_PORT)
# or: npm run serve:watch
```

Routes:

- `GET /health` → `{ "ok": true, "model": "<model>" }`
- `POST /suggest-mappings` → body is an `ArgumentMappingInput`, response is an
  `ArgumentMappingResult` (CORS-open for local dev).

```bash
curl -s -X POST http://localhost:5174/suggest-mappings \
  -H 'Content-Type: application/json' \
  -d @examples/sample-mapping-input.json
```

The frontend points at this via `VITE_AI_URL` (default `http://localhost:5174`).

## Programmatic use

```ts
import { recommendArgumentMappings } from 'mcp-playground-ai-services';

const result = await recommendArgumentMappings({
  currentNode: {
    tool: 'everything__echo',
    description: 'Echoes back the provided message string.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  previousNodes: [
    {
      nodeId: 'sum',
      tool: 'everything__get-sum',
      description: 'Adds two numbers and returns text content.',
      response: { content: [{ type: 'text', text: '12' }] },
    },
  ],
});

result.args;
// { message: { $ref: { nodeId: 'sum', path: '$.content[0].text' } } }
```

### Result shape

- `mappings[]` — one entry per argument: `decision` (`reference` | `literal` |
  `unmapped`), the chosen `ref`/`value`, `confidence`, a one-line `reasoning`,
  and `pathResolves` (whether the chosen path actually exists in the response —
  a guard against hallucinated paths).
- `args` — ready-to-paste workflow node `args` built from the mappings.
- `model` — the Ollama model that produced the recommendation.

## Configuration

| Env var                  | Default                      | Meaning                          |
| ------------------------ | ---------------------------- | -------------------------------- |
| `OLLAMA_BASE_URL`        | `http://localhost:11434/v1`  | OpenAI-compatible endpoint       |
| `OLLAMA_API_KEY`         | `ollama`                     | Ignored by Ollama; SDK needs it  |
| `OLLAMA_MODEL`           | `llama3.1`                   | Model name pulled in Ollama      |
| `AI_TEMPERATURE`         | `0`                          | Sampling temperature             |
| `AI_REQUEST_TIMEOUT_MS`  | `60000`                      | Per-request timeout (ms)         |
| `AI_REASONING_EFFORT`    | `medium`                     | Thinking effort: `high`/`medium`/`low`/`none` |

### Thinking (reasoning) models

On thinking-capable models (e.g. `gemma4`, `qwen3.5`), the mapper enables
thinking via Ollama's OpenAI-compatible `reasoning_effort` field. The reasoning
trace is returned separately from the JSON answer (so `content` stays clean) and
is logged with the `thinking trace` prefix. Set `AI_REASONING_EFFORT=none` to
turn it off, or `high` for harder, more ambiguous responses. Non-thinking models
ignore the setting. The JSON parser also strips any inline `<think>…</think>`
block as a safety net.

## Troubleshooting

- **`model '<name>' not found`** — pull it first: `ollama pull <name>`, or point
  `OLLAMA_MODEL` at a model you already have (`ollama list`).
- **Empty `{}` / everything `unmapped`** — small or instruction-weak models
  sometimes return an empty object in strict JSON mode. Use a more capable
  local model (e.g. a larger Gemma/Llama/Qwen variant). The mapper validates
  and repairs output, but it can't conjure a recommendation the model never made.

## Scripts

- `npm run demo` — run the mapper against a JSON input file.
- `npm run typecheck` — type-check without emitting.
- `npm run build` — compile to `dist/`.
