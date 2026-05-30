import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PlaygroundConfig, RunRecord, ToolDescriptor, ToolResult } from "../types";
import { createMcpClient } from "../data/mcpClient";
import { EXAMPLE_CONFIG, validateConfig } from "../data/config";
import { seedArgs } from "../lib/schema";
import { AppStateContext } from "./appState";
import type { AppStateValue, ArgMode, ConnStatus, View } from "./appState";

export function AppStateProvider({ children }: { children: ReactNode }) {
  // One client instance for the app's lifetime; swap mock -> WS in one place.
  const clientRef = useRef(createMcpClient());

  const [view, setView] = useState<View>("home");
  const [configText, setConfigText] = useState("");
  const [config, setConfig] = useState<PlaygroundConfig | null>(null);

  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([]);
  const [skipped, setSkipped] = useState<AppStateValue["skipped"]>([]);
  const [failed, setFailed] = useState<AppStateValue["failed"]>([]);

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<string | null>(null);
  const [inspectorSource, setInspectorSource] = useState<"catalog" | "workflow" | null>(null);
  const [argsText, setArgsText] = useState("");
  const [argMode, setArgMode] = useState<ArgMode>("params");

  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);

  const loadExample = useCallback(() => setConfigText(EXAMPLE_CONFIG), []);

  const connect = useCallback(async (configOverride?: string) => {
    const result = validateConfig(configOverride ?? configText);
    if (!result.ok) {
      setConnStatus("error");
      setConnectError(result.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
      return;
    }
    setConfig(result.config);
    setConnStatus("connecting");
    setConnectError(null);
    try {
      const res = await clientRef.current.connect(result.config);
      setCatalog(res.catalog);
      setSkipped(res.skipped);
      setFailed(res.failed);
      setConnStatus("connected");
      setView("workspace");
    } catch (e) {
      setConnStatus("error");
      setConnectError((e as Error).message);
    }
  }, [configText]);

  const reset = useCallback(() => {
    setView("home");
    setConfigText("");
    setConfig(null);
    setConnStatus("idle");
    setConnectError(null);
    setCatalog([]);
    setSkipped([]);
    setFailed([]);
    setSelectedTool(null);
    setSelectedWorkflowNodeId(null);
    setInspectorSource(null);
    setArgsText("");
    setRuns([]);
    setRunning(false);
  }, []);

  // Non-destructive navigation: keep the connection/catalog/runs intact so the
  // user can hop to the home screen and back without reconnecting.
  const goHome = useCallback(() => setView("home"), []);
  const goWorkspace = useCallback(() => setView("workspace"), []);

  const selectedDescriptor = useMemo(
    () => catalog.find((t) => t.qualifiedName === selectedTool) ?? null,
    [catalog, selectedTool],
  );

  const selectTool = useCallback(
    (qualifiedName: string) => {
      const tool = catalog.find((t) => t.qualifiedName === qualifiedName) ?? null;
      setSelectedTool(qualifiedName);
      setSelectedWorkflowNodeId(null);
      setInspectorSource("catalog");
      setArgsText(tool ? seedArgs(tool.inputSchema) : "{}");
      setRunning(false);
    },
    [catalog],
  );

  const selectWorkflowNode = useCallback((nodeId: string, qualifiedName: string) => {
    setSelectedWorkflowNodeId(nodeId);
    setSelectedTool(qualifiedName);
    setInspectorSource("workflow");
  }, []);

  const callTool = useCallback(
    async (qualifiedName: string, args: Record<string, unknown>): Promise<ToolResult> => {
      return clientRef.current.callTool(qualifiedName, args);
    },
    [],
  );

  const runTool = useCallback(async () => {
    const tool = catalog.find((t) => t.qualifiedName === selectedTool);
    if (!tool) return;

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(argsText || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      args = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    setRunning(true);
    const startedAt = Date.now();
    try {
      const result = await clientRef.current.callTool(tool.qualifiedName, args);
      setRuns((prev) => [
        ...prev,
        {
          qualifiedName: tool.qualifiedName,
          args,
          result,
          status: result.isError ? "error" : "success",
          durationMs: Date.now() - startedAt,
          at: startedAt,
        },
      ]);
    } catch (e) {
      setRuns((prev) => [
        ...prev,
        {
          qualifiedName: tool.qualifiedName,
          args,
          result: { content: [{ type: "text", text: (e as Error).message }], isError: true },
          status: "error",
          durationMs: Date.now() - startedAt,
          at: startedAt,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [catalog, selectedTool, argsText]);

  const latestRunForSelected = useMemo(() => {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].qualifiedName === selectedTool) return runs[i];
    }
    return null;
  }, [runs, selectedTool]);

  const connectedCount = useMemo(
    () => new Set(catalog.map((t) => t.serverName)).size,
    [catalog],
  );

  const value: AppStateValue = useMemo(
    () => ({
      view,
      configText,
      config,
      connStatus,
      connectError,
      catalog,
      skipped,
      failed,
      connectedCount,
      inspectorSource,
      selectedTool,
      selectedWorkflowNodeId,
      selectedDescriptor,
      argsText,
      argMode,
      running,
      runs,
      latestRunForSelected,
      setConfigText,
      loadExample,
      connect,
      reset,
      goHome,
      goWorkspace,
      selectTool,
      selectWorkflowNode,
      setArgsText,
      setArgMode,
      runTool,
      callTool,
    }),
    [
      view,
      configText,
      config,
      connStatus,
      connectError,
      catalog,
      skipped,
      failed,
      connectedCount,
      inspectorSource,
      selectedTool,
      selectedWorkflowNodeId,
      selectedDescriptor,
      argsText,
      argMode,
      running,
      runs,
      latestRunForSelected,
      loadExample,
      connect,
      reset,
      goHome,
      goWorkspace,
      selectTool,
      selectWorkflowNode,
      runTool,
      callTool,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
