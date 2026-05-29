import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Workflow, parseWorkflow } from '../types/workflow.js';

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
  return parseWorkflow(parsed);
}
