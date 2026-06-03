# Collector charts workflow (with MCP config)

A multi-layered DAG workflow that drives the **collector** Prism MCP (the REST API over collected SQLite data) and renders line/pie charts with the **AntV** chart MCP.

- `mcp-config-collector.json` - two MCP servers: `collector` (the generated Prism MCP) and `chart` (`@antv/mcp-server-chart`).
- `workflow-collector-charts.json` - 26-node, 6-layer DAG that calls **all 19** collector tools and feeds the chart-ready output straight into AntV.

## What it does (6 layers)

1. Discovery: `get_health`, `get_listdatabases`, `get_metadata`
2. Lists: `get_listclusters`, `get_listvms`
3. Cluster drilldown: `get_cluster`, `get_clusterperf`, `get_listhosts` (filtered by the first cluster)
4. Host + VM detail: `get_host`, `get_hostperf`, `get_vm`, `get_vmperf`
5. Chart specs: `get_clusterlinechart`, `get_hostlinechart`, `get_vmlinechart`, `get_clustercapacitypie`, `get_hostcapacitypie`, `get_clusterscapacitypie`, `get_clusterstoragecontainerspie`
6. Visualize (AntV): 3x `generate_line_chart` + 4x `generate_pie_chart`, each fed via `$ref` from its layer-5 node and returning an image URL

Cross-node values are pulled with `$ref` JSONPaths. Because each collector tool returns `{"success": true, "data": {"api_response": ...}}`, the paths go through `$.structuredContent.data.api_response...` (e.g. the first cluster id is `$.structuredContent.data.api_response[0].moid`).

## Prerequisites

0. One-time, from the repo root: install [`uv`](https://docs.astral.sh/uv/) and bake absolute paths into the example configs:

```bash
./setup.sh
```

1. Start the bundled Prism REST API (must be on `http://localhost:8000`):

```bash
uv run --directory prism-mcp/rest-api python rest_server.py
```

2. The collector MCP is launched for you by `mcp-config-collector.json` via
   `uv run --directory prism-mcp/mcp-server`; `uv` provisions its deps on first
   launch, so there is no separate install step.

3. The `chart` server runs via `npx`, which needs **Node.js >= 18** (no install step; it is fetched on first launch).

## Run

Load `mcp-config-collector.json` and `workflow-collector-charts.json` in the MCP Playground, then execute. The 3 breakpoints (`n_metadata`, `n_cluster`, `n_viz_cluster_line`) let you inspect each layer before continuing.

## Notes

- `db` is intentionally omitted on every node so all nodes resolve against the server's default DB, which keeps `moid`/`host_id`/`vm_id` consistent across the run. To target a specific file, add `"db": "<name>.db"` to each node's `args` (use `get_listdatabases` to see options).
- The `$ref` paths assume the playground surfaces FastMCP's dict return directly under `structuredContent`. If the node inspector shows it wrapped under `result`, change the paths to `$.structuredContent.result.data.api_response...`.
- Charts only render if the selected DB has data: perf rows for the line charts and capacity columns for the pie charts. Empty arrays will make the AntV node error.
- AntV `@antv/mcp-server-chart` posts to AntV's hosted render service and returns an image URL. To lock it down, pin a version (e.g. `@antv/mcp-server-chart@<version>`) and/or set the `DISABLED_TOOLS` env var.
