# Collector dashboard (multi-MCP, end-to-end)

A maximal, hackathon-ready DAG that turns collected Prism data into a persisted,
prettified visual dashboard **and** a queryable knowledge graph — wiring **five**
MCP servers together in one workflow.

- `mcp-config-dashboard.json` - five MCP servers:
  - `collector` - the generated Prism MCP (REST API over collected SQLite data)
  - `chart` - [`@antv/mcp-server-chart`](https://github.com/antvis/mcp-server-chart) (line/donut image rendering)
  - `filesystem` - [`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) (persist chart URLs to `output/`)
  - `everything` - [`@modelcontextprotocol/server-everything`](https://github.com/modelcontextprotocol/servers/tree/main/src/everything) (`echo` milestones, `get-sum` totals)
  - `memory` - [`@modelcontextprotocol/server-memory`](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) (cluster -> host -> vm knowledge graph)
- `workflow-collector-dashboard.json` - 44-node, 7-layer DAG that calls **all 19**
  collector tools, renders styled charts, persists them, summarizes, and builds a graph.

## What it does (7 layers)

1. **Discover** (`collector`): `get_health`, `get_listdatabases`, `get_metadata`, `get_listclusters`, `get_listvms`
2. **Drill down** (`collector`): `get_cluster`, `get_clusterperf`, `get_listhosts`, `get_host`, `get_hostperf`, `get_vm`, `get_vmperf`
3. **Chart specs** (`collector`): `get_clusterlinechart`, `get_hostlinechart`, `get_vmlinechart`, `get_clustercapacitypie` (storage **and** memory), `get_hostcapacitypie`, `get_clusterscapacitypie`, `get_clusterstoragecontainerspie`
4. **Visualize** (`chart`/AntV): 3x styled `generate_line_chart` + 5x donut `generate_pie_chart`, each fed via `$ref`, returning an image URL
5. **Persist** (`filesystem`): `create_directory`, 8x `write_file` (one URL per chart into `output/`), then `list_directory`
6. **Summarize** (`everything`): `echo` the cluster name and the primary chart URL; `get-sum` the cluster's Used + Free storage into a total
7. **Knowledge graph** (`memory`): `create_entities` (cluster/host/vm, with chart URLs as observations), `create_relations` (`has_host`, `runs_vm`), `read_graph`

Cross-node values flow with `$ref` JSONPaths:
- **collector** tools return `{"success": true, "data": {"api_response": ...}}`, so paths go through `$.structuredContent.data.api_response...` (e.g. first cluster id = `$.structuredContent.data.api_response[0].moid`; a line chart's series = `...api_response.data`).
- **AntV/filesystem/everything/memory** results are read off the raw tool result, e.g. each chart's image URL is `$.content[0].text`.

## Prettier, properly-scaled charts

The collector chart endpoints now scale raw values into human units before they
reach AntV, so the charts are readable without any client-side math:

- **Utilization** lines come back as **percent** with `axisYTitle: "%"` (title gets a `(%)` suffix).
- **Capacity** pies (storage/memory/logical) and storage containers are rolled up from MiB to **GiB/TiB**, with the unit in the title (e.g. `... storage (TiB) used vs free`). A single unit is chosen per chart so slices stay comparable.
- IOPS / counts stay unitless.

AntV styling is set per node: line charts use `theme: "academy"`, `1040x600`,
`style.lineWidth: 3`, `style.startAtZero: true`; pies are donuts (`innerRadius: 0.6`,
`820x620`).

## Prerequisites

0. One-time, from the repo root: install [`uv`](https://docs.astral.sh/uv/) and bake absolute paths into the example configs:

```bash
./setup.sh
```

1. Start the bundled Prism REST API (must be on `http://localhost:8000`):

```bash
uv run --directory prism-mcp/rest-api python rest_server.py
```

2. The collector MCP is launched for you by `mcp-config-dashboard.json` via
   `uv run --directory prism-mcp/mcp-server`; `uv` provisions its deps on first
   launch, so there is no separate install step.

3. `chart`, `filesystem`, `everything`, `memory` all run via `npx` (**Node.js >= 18**);
   they are fetched on first launch (the first run is slower — see Timeouts below).

4. The `filesystem` server is locked to this example directory and the workflow
   writes to its `output/` subfolder. It already exists in the repo; if you moved
   things, recreate it:

```bash
mkdir -p examples/collector_dashboard_with_mcp/output
```

## Run

Load `mcp-config-dashboard.json` and `workflow-collector-dashboard.json` in the MCP
Playground, then execute. Four breakpoints (`n_metadata`, `n_cluster`,
`n_viz_cluster_line`, `n_mem_read`) let you inspect each phase: the discovered
metadata, the drilled-into cluster, the first rendered chart URL, and the final
knowledge graph. After a run, open `output/*.url.txt` for the chart image URLs.

## Notes & caveats

- **The metric fix.** The slice metric for storage containers must be one of
  `consumed | capacity | freespace`. This workflow uses `metric: "consumed"`. An
  invalid value (the older example passed `"storage_consumed"`) makes the endpoint
  return HTTP 400, which leaves the tool result without `data` and breaks the
  downstream `$ref` (`... hit undefined before token ".api_response"`).
- **Regenerating the MCP is optional.** The downloaded `server.py` proxies
  `http://localhost:8000` at runtime, so the unit-scaling above is live immediately —
  no regeneration needed. Regenerate the collector MCP only if you want to expose the
  new optional endpoint params (`points` for line downsampling, `top_n` for pie
  capping); once regenerated you can add e.g. `"points": 200` / `"top_n": 8` to the
  collector chart nodes for even cleaner visuals.
- **AntV needs non-empty data.** If a chosen series is empty in the selected DB, that
  AntV node errors and only its branch (its filesystem write and any memory observation
  that references it) is skipped — the rest of the DAG still completes. The nodes target
  the first cluster/host/VM and default datasets, which are populated in the bundled DB.
- **`db` is omitted** on every node so all nodes resolve against the server's default DB,
  keeping `moid`/`host_id`/`vm_id` consistent across the run. To target a specific file,
  add `"db": "<name>.db"` to each node's `args` (use `get_listdatabases` to see options).
- **`filesystem` is sandboxed** to this example directory (its single allowed root). All
  writes are confined to `output/`; paths outside the root are rejected.
- **Timeouts.** The playground backend uses a 90s connect timeout and a 180s per-call
  timeout (600s overall, reset on progress) so first-run `npx` cold-starts and chart
  renders don't time out.
- **AntV** posts to AntV's hosted render service and returns an image URL. To lock it
  down, pin a version (`@antv/mcp-server-chart@<version>`) and/or set `DISABLED_TOOLS`.
- **`memory` persistence.** The knowledge graph is written to the memory server's
  `memory.jsonl`. Set `MEMORY_FILE_PATH` in the config's `memory.env` to relocate it.
