// Global UI state contract. Kept separate from the provider component so that
// the file only exports a hook/context/types — satisfies react-refresh's
// only-export-components rule.

import { createContext, useContext } from "react";
import type { ConnectResult, PlaygroundConfig, RunRecord, ToolDescriptor } from "../types";

export type View = "home" | "workspace";
export type ArgMode = "params" | "raw";
export type ConnStatus = "idle" | "connecting" | "connected" | "error";

export type AppStateValue = {
  // navigation + config
  view: View;
  configText: string;
  config: PlaygroundConfig | null;

  // connection
  connStatus: ConnStatus;
  connectError: string | null;
  catalog: ToolDescriptor[];
  skipped: ConnectResult["skipped"];
  failed: ConnectResult["failed"];
  connectedCount: number;

  // selection + args (Pane 3)
  selectedTool: string | null;
  selectedDescriptor: ToolDescriptor | null;
  argsText: string;
  argMode: ArgMode;

  // runs
  running: boolean;
  runs: RunRecord[];
  latestRunForSelected: RunRecord | null;

  // actions
  setConfigText: (text: string) => void;
  loadExample: () => void;
  connect: () => Promise<void>;
  reset: () => void;
  selectTool: (qualifiedName: string) => void;
  setArgsText: (text: string) => void;
  setArgMode: (mode: ArgMode) => void;
  runTool: () => Promise<void>;
};

export const AppStateContext = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within an AppStateProvider");
  return ctx;
}
