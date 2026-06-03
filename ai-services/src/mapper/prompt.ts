import type { ChatMessage } from '../llm/client.js';
import { enumeratePaths, type PathCandidate } from '../json-paths.js';
import type { ArgumentMappingInput, PreviousNodeContext } from '../types.js';

/**
 * The mapper does the heavy lifting in the prompt: it gives the model the
 * downstream tool's input schema, plus — for each upstream node — the real
 * response and a pre-computed list of concrete JSONPaths into it. The model's
 * only job is to match each argument to the best candidate path (or a literal,
 * or nothing). Forcing it to choose from an enumerated path list dramatically
 * cuts hallucinated references.
 */

const SYSTEM_PROMPT = `You are an expert at wiring together Model Context Protocol (MCP) tool calls inside a visual workflow builder.

You are given:
- The CURRENT tool that needs its arguments filled (name, description, JSON Schema of its inputs).
- One or more PREVIOUS tools that already ran, each with: its node id, its name/description, the actual JSON response it returned, and a list of valid JSONPaths into that response.

Your task: for EACH argument in the current tool's input schema, decide how it should be filled:
- "reference": the argument should be wired from a previous tool's response. Choose the single best JSONPath from the provided candidate list for that node. NEVER invent a path that is not in the candidate list.
- "literal": no upstream value fits, but the schema/description implies an obvious constant (e.g. a default, an enum value). Provide it in "value".
- "unmapped": you cannot confidently fill it; leave it for the user.

Matching guidance:
- Prefer references over literals whenever an upstream value is a good semantic fit.
- Match on meaning, not just name: an argument "message" can map to a response's text content; "id" can map to "...[0].id"; etc.
- Respect types: only map a path whose value type is compatible with the argument's schema type (a string arg needs a string-valued path, a number arg a number-valued path, etc.).
- Prefer LEAF values (string/number/boolean) over whole objects or arrays, unless the argument's own type is object/array. When the value lives inside a list, pick a concrete index, e.g. "$.items[0].id".
- Honor "required" fields first; do your best to fill them.
- Set "confidence" between 0 and 1 reflecting how sure you are.
- Keep "reasoning" to one short sentence.

JSONPath rules (must follow exactly): paths look like "$", "$.foo", "$.foo.bar", "$.items[0]", "$.items[0].id", or "$[\\"weird.key\\"]". No wildcards, no recursive descent, no filters. Only use paths from the candidate list.

Respond with ONLY a JSON object of this exact shape (no markdown, no prose):
{
  "mappings": [
    {
      "argument": "<arg name>",
      "decision": "reference" | "literal" | "unmapped",
      "ref": { "nodeId": "<previous node id>", "path": "<one of the candidate paths>" },
      "value": <literal value, only when decision is "literal">,
      "confidence": <number 0..1>,
      "reasoning": "<one short sentence>"
    }
  ]
}
Include "ref" only when decision is "reference". Include "value" only when decision is "literal". Produce one entry for every argument in the current tool's input schema.

Worked examples (study how each argument is reasoned about, then do the same for the real input):

EXAMPLE A — text content feeds a string argument
CURRENT TOOL: everything__echo
Arguments to fill:
  - message (string) [required] — The text to echo back.
Available upstream responses:
PREVIOUS NODE id="sum" tool: everything__get-sum
  candidate paths: $.content[0].text → string: "42"
Expected output:
{ "mappings": [ { "argument": "message", "decision": "reference", "ref": { "nodeId": "sum", "path": "$.content[0].text" }, "confidence": 0.95, "reasoning": "Echo's text comes from the upstream result's text content." } ] }

EXAMPLE B — pick an id out of a list, leave unknowns unmapped
CURRENT TOOL: vm__get_details
Arguments to fill:
  - vmId (string) [required] — Id of the VM to fetch.
  - verbose (boolean) [optional] — Include extended fields.
Available upstream responses:
PREVIOUS NODE id="list" tool: vm__list_vms
  candidate paths:
    $.vms[0].id → string: "vm-abc-123"
    $.vms[0].name → string: "web-1"
    $.vms[0].powerState → string: "ON"
Expected output:
{ "mappings": [
  { "argument": "vmId", "decision": "reference", "ref": { "nodeId": "list", "path": "$.vms[0].id" }, "confidence": 0.9, "reasoning": "vmId matches the id of the first listed VM (string leaf inside the list)." },
  { "argument": "verbose", "decision": "unmapped", "confidence": 0.4, "reasoning": "No upstream value indicates verbosity." }
] }

EXAMPLE C — literal when the schema implies a sensible constant
CURRENT TOOL: search__query
Arguments to fill:
  - query (string) [required] — Search text.
  - limit (number) [optional] — Max results (default 10).
Available upstream responses:
PREVIOUS NODE id="q" tool: prompt__capture
  candidate paths: $.content[0].text → string: "san francisco weather"
Expected output:
{ "mappings": [
  { "argument": "query", "decision": "reference", "ref": { "nodeId": "q", "path": "$.content[0].text" }, "confidence": 0.85, "reasoning": "The captured text is the search query." },
  { "argument": "limit", "decision": "literal", "value": 10, "confidence": 0.6, "reasoning": "No upstream count; use the schema's default of 10." }
] }`;

function describeArguments(inputSchema: Record<string, unknown>): string {
  const props = (inputSchema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  );
  const names = Object.keys(props);
  if (names.length === 0) {
    return '(this tool takes no arguments)';
  }
  return names
    .map((name) => {
      const spec = (props[name] ?? {}) as Record<string, unknown>;
      const type = spec.type ? String(spec.type) : 'any';
      const desc = spec.description ? ` — ${String(spec.description)}` : '';
      const req = required.has(name) ? ' [required]' : ' [optional]';
      return `  - ${name} (${type})${req}${desc}`;
    })
    .join('\n');
}

function describePreviousNode(node: PreviousNodeContext): string {
  const candidates: PathCandidate[] = enumeratePaths(node.response);
  const candidateLines = candidates
    .map((c) => `    ${c.path}  →  ${c.type}: ${c.preview}`)
    .join('\n');

  const responseJson = safeJson(node.response, 2_000);

  return [
    `PREVIOUS NODE id="${node.nodeId}"`,
    `  tool: ${node.tool}`,
    node.description ? `  description: ${node.description}` : null,
    `  response (truncated):`,
    indent(responseJson, 4),
    `  valid JSONPaths into this node's response (pick from these only):`,
    candidateLines || '    (no addressable paths)',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function buildMessages(input: ArgumentMappingInput): ChatMessage[] {
  const { currentNode, previousNodes } = input;

  const userPrompt = [
    `CURRENT TOOL: ${currentNode.tool}`,
    currentNode.description ? `description: ${currentNode.description}` : null,
    ``,
    `Arguments to fill:`,
    describeArguments(currentNode.inputSchema),
    ``,
    `Full input JSON Schema:`,
    safeJson(currentNode.inputSchema, 2_000),
    ``,
    `=== Available upstream responses ===`,
    previousNodes.map(describePreviousNode).join('\n\n'),
    ``,
    `Now produce the mapping JSON.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function safeJson(value: unknown, max: number): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = 'undefined';
  return s.length > max ? `${s.slice(0, max)}\n… (truncated)` : s;
}
