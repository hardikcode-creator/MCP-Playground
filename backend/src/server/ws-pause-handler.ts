import type { BreakpointContext, PauseAction } from '../types/workflow.js';
import type { PauseHandler } from '../workflow/executor.js';

/**
 * The WebSocket counterpart to the CLI's CliRunController.
 *
 * When the executor hits a breakpoint it calls `onBreakpoint`, which parks a
 * resolver keyed by nodeId. The session resolves it later when a `pauseAction`
 * frame arrives over the socket (the user clicked Resume / Skip in the UI).
 *
 * Cancellation: when the run's AbortSignal fires, every still-parked pause is
 * resolved with `{ type: 'continue' }`. That's the cheapest way to unblock the
 * executor's `runNode`; its internal signal race in `handlePause` then marks
 * the node as caught-mid-flight before this resolution is observed (identical
 * to how CliRunController handles abort).
 */
export class WsPauseHandler implements PauseHandler {
  private readonly pending = new Map<string, (action: PauseAction) => void>();

  constructor(signal: AbortSignal) {
    signal.addEventListener('abort', () => {
      for (const resolve of this.pending.values()) resolve({ type: 'continue' });
      this.pending.clear();
    });
  }

  onBreakpoint(_ctx: BreakpointContext): Promise<PauseAction> {
    return new Promise<PauseAction>((resolve) => {
      this.pending.set(_ctx.nodeId, resolve);
    });
  }

  /**
   * Resolve a node that is currently paused. Returns false (no-op) if the node
   * isn't actually parked at a breakpoint — e.g. a stale frame after cancel.
   */
  resolve(nodeId: string, action: PauseAction): boolean {
    const resolve = this.pending.get(nodeId);
    if (!resolve) return false;
    this.pending.delete(nodeId);
    resolve(action);
    return true;
  }

  hasPending(nodeId: string): boolean {
    return this.pending.has(nodeId);
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
