// Boundary to the ai-services HTTP endpoint (POST /suggest-mappings).
// Panes/components depend only on suggestMappings()/AiMappingResult, never on
// fetch details. Point VITE_AI_URL at the running ai-services HTTP server
// (default http://localhost:5174); see ai-services/src/server/http.ts.

import type { JsonSchema, ToolResult } from "../types";

const AI_URL: string =
  (import.meta.env.VITE_AI_URL as string | undefined) || "http://localhost:5174";

// Mirrors ai-services ArgumentMappingInput.
export type AiCurrentNode = {
  tool: string;
  description?: string;
  inputSchema: JsonSchema;
};

export type AiPreviousNode = {
  nodeId: string;
  tool: string;
  description?: string;
  response: ToolResult | unknown;
};

export type AiMappingInput = {
  currentNode: AiCurrentNode;
  previousNodes: AiPreviousNode[];
};

// Mirrors ai-services ArgumentMapping / ArgumentMappingResult.
export type AiMappingDecision = "reference" | "literal" | "unmapped";

export type AiMapping = {
  argument: string;
  decision: AiMappingDecision;
  ref?: { nodeId: string; path: string };
  value?: unknown;
  confidence: number;
  reasoning: string;
  pathResolves?: boolean;
};

export type AiMappingResult = {
  tool: string;
  mappings: AiMapping[];
  args: Record<string, unknown>;
  model: string;
};

export class AiServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiServiceError";
  }
}

// Ask the AI service to recommend how each argument of the current node should
// be wired from upstream node responses. Throws AiServiceError on any failure
// (service down, model unreachable, bad input) with a human-readable message.
export async function suggestMappings(input: AiMappingInput): Promise<AiMappingResult> {
  let res: Response;
  try {
    res = await fetch(`${AI_URL}/suggest-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    throw new AiServiceError(
      `Can't reach the AI service at ${AI_URL}. Is it running? (cd ai-services && npm run serve) — ${(err as Error).message}`,
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body; fall through to status-based error below.
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `AI service responded ${res.status}`;
    throw new AiServiceError(message);
  }

  return body as AiMappingResult;
}

export const AI_SERVICE_URL = AI_URL;
