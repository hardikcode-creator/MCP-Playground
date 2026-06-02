# Collector dashboard + GitHub publish (multi-MCP, end-to-end)

The collector dashboard, extended with a **GitHub publish stage**. After the data
is collected, charted, persisted, summarized, and turned into a knowledge graph,
the workflow creates a GitHub repo, commits the artifacts on a feature branch,
opens a pull request, and squash-merges it - wiring **six** MCP servers together.

- `mcp-config-dashboard-github.json` - six MCP servers:
  - `collector` - the generated Prism MCP (REST API over collected SQLite data)
  - `chart` - [`@antv/mcp-server-chart`](https://github.com/antvis/mcp-server-chart) (line/donut image rendering)
  - `filesystem` - [`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) (persist chart URLs to `output/`)
  - `everything` - [`@modelcontextprotocol/server-everything`](https://github.com/modelcontextprotocol/servers/tree/main/src/everything) (`echo` milestones, `get-sum` totals)
  - `memory` - [`@modelcontextprotocol/server-memory`](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) (cluster -> host -> vm knowledge graph)
  - `github` - [`@modelcontextprotocol/server-github`](https://github.com/modelcontextprotocol/servers/tree/main/src/github) (repo, branch, commits, PR, merge)
- `workflow-collector-dashboard-github.json` - 61-node, 8-layer DAG: the full
  collector dashboard plus the GitHub publish stage.

## What it does (8 layers)

1. **Discover** (`collector`): `get_health`, `get_listdatabases`, `get_metadata`, `get_listclusters`, `get_listvms`
2. **Drill down** (`collector`): `get_cluster`, `get_clusterperf`, `get_listhosts`, `get_host`, `get_hostperf`, `get_vm`, `get_vmperf`
3. **Chart specs** (`collector`): `get_clusterlinechart`, `get_hostlinechart`, `get_vmlinechart`, `get_clustercapacitypie` (storage **and** memory), `get_hostcapacitypie`, `get_clusterscapacitypie`, `get_clusterstoragecontainerspie`
4. **Visualize** (`chart`/AntV): 3x styled `generate_line_chart` + 5x donut `generate_pie_chart`, each fed via `$ref`, returning an image URL
5. **Persist** (`filesystem`): `create_directory`, 8x `write_file` (one URL per chart into `output/`), then `list_directory`
6. **Summarize** (`everything`): `echo` the cluster name and the primary chart URL; `get-sum` the cluster's Used + Free storage into a total
7. **Knowledge graph** (`memory`): `create_entities` (cluster/host/vm, with chart URLs as observations), `create_relations` (`has_host`, `runs_vm`), `read_graph`
8. **Publish** (`github`): `create_repository` -> `create_or_update_file` (seed default branch) -> `create_branch` -> serialized `create_or_update_file` commits (report + 8 chart-URL files + knowledge-graph.json) -> `list_commits` -> `create_pull_request` -> `get_pull_request` -> `merge_pull_request` (squash)

Cross-node values flow with `$ref` JSONPaths, and the three servers use **three
different result shapes** - the new GitHub stage mixes all of them:

- **collector** tools return `{"success": true, "data": {"api_response": ...}}`, so paths go through `$.structuredContent.data.api_response...` (e.g. first cluster id = `$.structuredContent.data.api_response[0].moid`).
- **chart / filesystem / memory** results are read off the raw tool result, e.g. each chart's image URL is `$.content[0].text`.
- **github** tools expose data at the top level: repo owner = `$.structuredContent.owner.login`, repo name = `$.structuredContent.name`, default branch = `$.structuredContent.default_branch`, PR number (integer) = `$.structuredContent.number`.

## How the dashboard data reaches GitHub

`$ref` resolution replaces a whole value - it does **not** interpolate a ref into
a larger string. So a committed file's `content` is either literal text or one
`$ref`. The bridge into GitHub is therefore file-per-artifact:

- `charts/<name>.url.txt` - `content` is a single ref to that AntV node's `$.content[0].text` (the image URL).
- `knowledge-graph.json` - `content` is a single ref to `memory.read_graph`'s `$.content[0].text` (which already embeds every chart URL as an observation).
- `DASHBOARD.md` - a static report (literal text), since per-run URLs can't be interpolated into markdown and the charts are hosted URLs rather than committed images.

## Prerequisites

0. One-time, from the repo root: install [`uv`](https://docs.astral.sh/uv/) and bake absolute paths into the example configs:

```bash
./setup.sh
```

1. Start the bundled Prism REST API (must be on `http://localhost:8000`):

```bash
uv run --directory prism-mcp/rest-api python rest_server.py
```

2. The collector MCP is launched for you by `mcp-config-dashboard-github.json` via
   `uv run --directory prism-mcp/mcp-server`; `uv` provisions its deps on first
   launch, so there is no separate install step.

3. `chart`, `filesystem`, `everything`, `memory`, `github` all run via `npx`
   (**Node.js >= 18**); they are fetched on first launch (the first run is
   slower - see Timeouts below).

4. **GitHub token.** Create a Personal Access Token with the `repo` scope
   (Settings -> Developer settings -> Personal access tokens) and paste it into
   `github.env.GITHUB_PERSONAL_ACCESS_TOKEN` in `mcp-config-dashboard-github.json`,
   replacing `ghp_REPLACE_WITH_YOUR_TOKEN`. The repo owner is derived at runtime
   from the token (via `create_repository` -> `owner.login`), so nothing else is
   hard-coded to a username.

5. The `filesystem` server is locked to this example directory and the workflow
   writes to its `output/` subfolder. It already exists in the repo; if you moved
   things, recreate it:

```bash
mkdir -p examples/collector_dashboard_github_with_mcp/output
```

## Run

Load `mcp-config-dashboard-github.json` and `workflow-collector-dashboard-github.json`
in the MCP Playground, then execute. Seven breakpoints (`n_metadata`, `n_cluster`,
`n_viz_cluster_line`, `n_mem_read`, `gh_create_repo`, `gh_open_pr`, `gh_inspect_pr`)
let you inspect each phase: the discovered metadata, the drilled-into cluster, the
first rendered chart URL, the final knowledge graph, the new repo, the opened PR,
and the inspected PR. After a run, open `output/*.url.txt` for the local chart URLs
and the new GitHub repo for the committed dashboard + merged PR.

## Notes & caveats

- **Re-runs need a fresh repo.** This workflow creates a brand-new repo
  (`nutanix-collector-dashboard`) and a fixed branch (`feature/collector-dashboard`)
  each run. GitHub returns HTTP 422 if either already exists, so before re-running
  **delete the repo on GitHub** (or rename `gh_create_repo.args.name` and the
  `branch` / `head` / `from_branch` values to something new).
- **Commits are serialized on purpose.** `create_or_update_file` commits onto the
  branch head; two concurrent commits race the head SHA and one fails (non-fast-
  forward / 409). The 10 commit nodes are therefore chained (each `dependsOn` the
  previous commit), so they apply one after another.
- **The GitHub stage is gated on the whole dashboard.** `gh_create_repo`
  `dependsOn` `["n_fs_list", "n_mem_read"]`, so publishing only starts once the
  charts are persisted and the knowledge graph is built. This couples the GitHub
  stage to every chart + the memory branch succeeding (true on the bundled DB). If
  you run against a sparse DB where a series is empty, repoint
  `gh_create_repo.dependsOn` to `["n_clusters"]` to decouple, and drop any commit
  node whose `$ref` source did not produce data.
- **`knowledge-graph.json` content** uses `n_mem_read`'s `$.content[0].text`. If a
  memory-server build returns the graph only under `structuredContent` (no text
  block), that single commit will fail to resolve - remove `gh_commit_graph` (and
  re-point `gh_list_commits` / `gh_open_pr` `dependsOn` to `gh_commit_containers_pie`).
- **The metric fix.** The slice metric for storage containers must be one of
  `consumed | capacity | freespace`; this workflow uses `metric: "consumed"`.
- **Regenerating the collector MCP is optional.** The downloaded `server.py`
  proxies `http://localhost:8000` at runtime, so the unit-scaling is live
  immediately. Regenerate only to expose the optional `points` / `top_n` params.
- **AntV needs non-empty data.** If a chosen series is empty, that AntV node errors
  and only its branch (its filesystem write, GitHub commit, and memory observation)
  is affected. The nodes target the first cluster/host/VM and default datasets,
  which are populated in the bundled DB.
- **`filesystem` is sandboxed** to this example directory (its single allowed
  root). All writes are confined to `output/`.
- **Timeouts.** The playground backend uses a 90s connect timeout and a 180s
  per-call timeout (600s overall, reset on progress) so first-run `npx` cold-starts
  and the serialized GitHub commits don't time out.
- **`memory` persistence.** The knowledge graph is written to the memory server's
  `memory.jsonl`. Set `MEMORY_FILE_PATH` in the config's `memory.env` to relocate
  it. Re-runs accumulate into the same graph unless you clear it.
