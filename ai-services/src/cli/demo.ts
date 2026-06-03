import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recommendArgumentMappings } from '../mapper/argument-mapper.js';
import type { ArgumentMappingInput } from '../types.js';

/**
 * Tiny CLI to exercise the argument mapper against a JSON input file.
 *
 * Usage:
 *   npm run demo                         # uses examples/sample-mapping-input.json
 *   npm run demo -- path/to/input.json   # uses your own input
 *
 * Requires a running Ollama (`ollama serve`) with the configured model pulled.
 * Configure via .env / env vars (see .env.example).
 */
async function main(): Promise<void> {
  const inputPath = resolve(
    process.argv[2] ?? 'examples/sample-mapping-input.json',
  );

  let input: ArgumentMappingInput;
  try {
    input = JSON.parse(await readFile(inputPath, 'utf8')) as ArgumentMappingInput;
  } catch (err) {
    console.error(`Failed to read input "${inputPath}": ${(err as Error).message}`);
    process.exit(1);
  }

  console.error(`\n[ai-services] Recommending mappings for "${input.currentNode.tool}"`);
  console.error(
    `[ai-services] Upstream nodes: ${input.previousNodes.map((n) => n.nodeId).join(', ')}\n`,
  );

  try {
    const result = await recommendArgumentMappings(input);

    console.error(`Model: ${result.model}\n`);
    for (const m of result.mappings) {
      const conf = `${Math.round(m.confidence * 100)}%`;
      if (m.decision === 'reference') {
        const flag = m.pathResolves === false ? '  ⚠ path did not resolve' : '';
        console.error(
          `  ${m.argument}: ⇽ $ref ${m.ref?.nodeId}.${m.ref?.path}  (${conf})${flag}`,
        );
      } else if (m.decision === 'literal') {
        console.error(`  ${m.argument}: = ${JSON.stringify(m.value)}  (${conf})`);
      } else {
        console.error(`  ${m.argument}: (unmapped)  (${conf})`);
      }
      if (m.reasoning) console.error(`      ↳ ${m.reasoning}`);
    }

    console.error(`\nWorkflow-ready args:\n`);
    console.log(JSON.stringify(result.args, null, 2));
  } catch (err) {
    console.error(`\n[ai-services] failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[ai-services] Fatal error:', err);
  process.exit(1);
});
