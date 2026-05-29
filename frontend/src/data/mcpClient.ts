// The single backend boundary. Panes and state depend only on this interface,
// never on fetch/WebSocket/message shapes. Swapping the mock for the real
// transport is a one-line change in createMcpClient().

import type { ConnectResult, PlaygroundConfig, ToolResult } from "../types";
import { MockMcpClient } from "./mockMcpClient";

export interface McpClient {
  // Upload-time handshake: send the config, get the tool catalog back.
  connect(config: PlaygroundConfig): Promise<ConnectResult>;
  // Invoke a single tool; resolves with the full MCP result envelope.
  callTool(qualifiedName: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// now:   createMcpClient() -> new MockMcpClient()
// later: createMcpClient() -> new WebSocketMcpClient(import.meta.env.VITE_MCP_WS_URL)
export function createMcpClient(): McpClient {
  return new MockMcpClient();
}

// Stub for the future transport. Protocol sketch over a single socket (JSON):
//   -> { id, type: "connect",  config }
//   <- { id, type: "connected", catalog, skipped, failed }
//   -> { id, type: "callTool", qualifiedName, args }
//   <- { id, type: "toolResult", result } | { id, type: "error", error }
export class WebSocketMcpClient implements McpClient {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<ConnectResult> {
    throw new Error(`WebSocketMcpClient(${this.url}) is not implemented yet`);
  }

  async callTool(): Promise<ToolResult> {
    throw new Error(`WebSocketMcpClient(${this.url}) is not implemented yet`);
  }
}
