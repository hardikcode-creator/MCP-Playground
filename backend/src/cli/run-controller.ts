import * as readline from 'node:readline';
import type {
  BreakpointContext,
  PauseAction,
} from '../types/workflow.js';
import type { PauseHandler } from '../workflow/executor.js';

/**
 * Hooks the controller calls in response to user commands. Passed as
 * callbacks (rather than an executor reference) so the controller doesn't
 * have to know about the executor class, and so a chicken-and-egg
 * construction order isn't required — the closure can capture an executor
 * that's assigned on the very next line.
 */
export interface RunControllerHooks {
  abortController: AbortController;
  setBreakpoint(nodeId: string): void;
  clearBreakpoint(nodeId: string): void;
}

/**
 * CLI side-channel for an interactive workflow run.
 *
 * Wears two hats:
 *   1. `PauseHandler` — when the executor hits a breakpoint, this enqueues
 *      the pause and surfaces it to the user via stderr. The promise
 *      resolves when the user issues a resume command on stdin (Enter,
 *      `c`/`continue`, or `s`/`skip`).
 *   2. Live command channel — at ANY time during the run (whether paused or
 *      not), the user can type:
 *           bp <nodeId>       → executor.setBreakpoint(nodeId)
 *           clear <nodeId>    → executor.clearBreakpoint(nodeId)
 *           q | quit | cancel → abort the workflow (same as Ctrl+C)
 *           ? | help          → reprint command list
 *
 * Pauses are queued FIFO; <Enter> resumes the oldest still-paused node.
 * This matters because the engine permits multiple concurrent pauses on
 * parallel branches (each branch runs in its own runNode promise, and
 * breakpoints don't block the main loop — so two parallel nodes can both be
 * sitting at breakpoints at the same time).
 *
 * Signal handling: if the abort controller fires, every still-queued pause
 * resolves with `{ type: 'continue' }`. That's the cheapest way to unblock
 * runNode; the executor's signal race in `handlePause` will then mark the
 * node cancelled before it ever sees this resolution.
 */
export class CliRunController implements PauseHandler {
  private readonly rl: readline.Interface;
  private readonly pauseQueue: Array<{
    ctx: BreakpointContext;
    resolve: (action: PauseAction) => void;
  }> = [];
  private disposed = false;

  constructor(private readonly hooks: RunControllerHooks) {
    this.rl = readline.createInterface({ input: process.stdin });
    this.rl.on('line', (line) => this.handleLine(line));

    this.hooks.abortController.signal.addEventListener('abort', () => {
      while (this.pauseQueue.length > 0) {
        this.pauseQueue.shift()!.resolve({ type: 'continue' });
      }
    });
  }

  printHelp(): void {
    console.error(
      `\n[mcp-playground] interactive commands (type any time during the run):\n` +
        `   <Enter>            resume oldest paused node (continue)\n` +
        `   c | continue       same as <Enter>\n` +
        `   s | skip           resume oldest paused node by SKIPPING it\n` +
        `   bp <nodeId>        add runtime breakpoint (fires when that node runs)\n` +
        `   clear <nodeId>     remove a runtime breakpoint\n` +
        `   q | quit | cancel  cancel the workflow (same as Ctrl+C)\n` +
        `   ? | help           show this help again\n`,
    );
  }

  // ── PauseHandler ──────────────────────────────────────────────────────────

  async onBreakpoint(
    ctx: BreakpointContext,
    _signal?: AbortSignal,
  ): Promise<PauseAction> {
    return new Promise<PauseAction>((resolve) => {
      this.pauseQueue.push({ ctx, resolve });
      const queueNote =
        this.pauseQueue.length > 1
          ? `   (${this.pauseQueue.length} pauses queued; resume in order)`
          : '';
      console.error(
        `\n  ⏸ [paused] ${ctx.nodeId}  (source: ${ctx.source})  → press <Enter> to continue, 's' to skip`,
      );
      console.error(`         tool: ${ctx.tool}`);
      console.error(
        `         args: ${truncate(JSON.stringify(ctx.args), 240)}`,
      );
      if (queueNote) console.error(queueNote);
    });
  }

  // ── cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rl.close();
  }

  // ── stdin command dispatch ────────────────────────────────────────────────

  private handleLine(rawLine: string): void {
    const line = rawLine.trim();

    if (line === '' || line === 'c' || line === 'continue') {
      this.resumeOldest({ type: 'continue' }, /*verb*/ 'continued');
      return;
    }
    if (line === 's' || line === 'skip') {
      this.resumeOldest({ type: 'skip' }, /*verb*/ 'skipped');
      return;
    }
    if (line === '?' || line === 'help') {
      this.printHelp();
      return;
    }
    if (line === 'q' || line === 'quit' || line === 'cancel') {
      if (this.hooks.abortController.signal.aborted) {
        console.error(`[mcp-playground] already cancelling…`);
      } else {
        console.error(`[mcp-playground] cancelling workflow…`);
        this.hooks.abortController.abort();
      }
      return;
    }

    const bpMatch = line.match(/^bp\s+(\S+)$/);
    if (bpMatch && bpMatch[1]) {
      this.hooks.setBreakpoint(bpMatch[1]);
      return;
    }
    const clearMatch = line.match(/^clear\s+(\S+)$/);
    if (clearMatch && clearMatch[1]) {
      this.hooks.clearBreakpoint(clearMatch[1]);
      return;
    }

    console.error(
      `[mcp-playground] unknown command: "${line}"   (type ? for help)`,
    );
  }

  private resumeOldest(action: PauseAction, verb: string): void {
    const item = this.pauseQueue.shift();
    if (!item) {
      // No active pause — common case: user hit Enter idly. Don't be noisy.
      return;
    }
    console.error(`         → ${verb} ${item.ctx.nodeId}`);
    item.resolve(action);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s;
}
