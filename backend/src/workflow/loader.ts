import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { type Workflow, WorkflowSchema } from '../types/workflow.js';
import { normalizeWorkflow } from './graph.js';

/**
 * Read a workflow JSON file, validate its shape, and return the NORMALIZED
 * form (with `dependsOn` already unioned from refs). Anything downstream
 * (executor, future UI, future MCP-server wrapper) can rely on the canonical
 * shape without re-normalizing.
 */
export async function loadWorkflowFromFile(
  filePath: string,
): Promise<Workflow> {
  const absPath = resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read workflow file at ${absPath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Workflow file at ${absPath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  return normalizeWorkflow(parseWorkflow(parsed));
}

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const lines = issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    super(`Workflow validation failed:\n${lines.join('\n')}`);
    this.name = 'WorkflowValidationError';
  }
}

export function parseWorkflow(value: unknown): Workflow {
  const result = WorkflowSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowValidationError(result.error.issues);
  }
  return result.data;
}
