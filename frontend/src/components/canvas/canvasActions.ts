import { createContext, useContext } from "react";

// Lets a React Flow node component reach back into the workflow store without
// threading callbacks through node `data` (which would pollute serialization)
// or relying on updateNodeData (unreliable with controlled nodes).
export type CanvasActions = {
  toggleBreakpoint: (nodeId: string) => void;
};

export const CanvasActionsContext = createContext<CanvasActions>({
  toggleBreakpoint: () => {},
});

export function useCanvasActions(): CanvasActions {
  return useContext(CanvasActionsContext);
}
