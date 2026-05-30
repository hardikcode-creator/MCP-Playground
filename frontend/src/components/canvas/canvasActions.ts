import { createContext, useContext } from "react";

// Lets a React Flow node component reach back into the workflow store without
// threading callbacks through node `data` (which would pollute serialization)
// or relying on updateNodeData (unreliable with controlled nodes).
export type CanvasActions = {
  toggleBreakpoint: (nodeId: string) => void;
  // Resume a failed run: re-run the failed node(s) and everything downstream,
  // keeping the results of already-completed nodes. Surfaced on the failed node.
  retry: () => void;
  // Whether a retry can be triggered right now (not running, no cycle/invalid args).
  retryEnabled: boolean;
};

export const CanvasActionsContext = createContext<CanvasActions>({
  toggleBreakpoint: () => {},
  retry: () => {},
  retryEnabled: false,
});

export function useCanvasActions(): CanvasActions {
  return useContext(CanvasActionsContext);
}
