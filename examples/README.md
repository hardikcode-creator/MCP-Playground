# Examples

Ready-to-load MCP configs + workflows for the MCP Playground. Each folder is a
self-contained example; load the listed **config** and **workflow** in the UI,
then run.

> Before running any collector example, bake in absolute paths once from the repo
> root: `./setup.sh` (see the top-level `cmd.txt`).

## Foundational demos (no credentials)

| Example | What it shows | Config | Workflow |
| --- | --- | --- | --- |
| [`hello_world`](hello_world/) | Smallest workflow; smoke test | `_shared_configs/mcp-config-multi.json` | `workflow-hello.json` |
| [`breakpoints_demo`](breakpoints_demo/) | Breakpoints / step-through | `_shared_configs/mcp-config-multi.json` | `workflow-with-breakpoint.json` |
| [`dependson_demo`](dependson_demo/) | Explicit ordering with `dependsOn` | `_shared_configs/mcp-config-multi.json` | `workflow-with-dependson.json` |
| [`multi_layered_demo`](multi_layered_demo/) | 25-node multi-layer DAG (fan-out/fan-in) | `_shared_configs/mcp-config-multi.json` | `workflow-multi-layered-25.json` |
| [`everything_demo`](everything_demo/) | Broad `everything` server smoke test | `_shared_configs/mcp-config-multi.json` | `workflow-everything-25.json` |

## Multi-MCP & external services

| Example | What it shows | Config | Workflow | Needs |
| --- | --- | --- | --- | --- |
| [`multi_mcp_tokens_demo`](multi_mcp_tokens_demo/) | Two servers + env-var token injection | `mcp-config-tokens.json` | `workflow-multi-mcp-tokens.json` | GitHub PAT |
| [`zomato_feast_demo`](zomato_feast_demo/) | Remote/hosted MCP via `mcp-remote` | `mcp-config-zomato.json` | `workflow-zomato-feast-25.json` | network |
| [`github_workflow_with_mcp`](github_workflow_with_mcp/) | Create repo -> branch -> commit -> PR | `mcp-config-github.json` | `workflow-github-repo-pr.json` | GitHub PAT |
| [`nutanix_api_workflow_with_mcp`](nutanix_api_workflow_with_mcp/) | Walk Nutanix clusters/CVMs/VMs/disks | `mcp-config-nutanix.json` | `workflow-nutanix.json` | Nutanix creds |

## Custom Prism MCP (the headline demos)

These drive the bundled [Prism MCP](../prism-mcp/) (collected Nutanix data ->
REST -> MCP). Start the REST API first: `uv run --directory prism-mcp/rest-api python rest_server.py`.

| Example | What it shows | Config | Workflow | Servers |
| --- | --- | --- | --- | --- |
| [`collector_charts_workflow_with_mcp`](collector_charts_workflow_with_mcp/) | All 19 collector tools -> AntV line/pie charts | `mcp-config-collector.json` | `workflow-collector-charts.json` | collector, chart |
| [`collector_dashboard_with_mcp`](collector_dashboard_with_mcp/) | Full dashboard: charts + persist + summarize + knowledge graph | `mcp-config-dashboard.json` | `workflow-collector-dashboard.json` | collector, chart, filesystem, everything, memory |
| [`collector_dashboard_github_with_mcp`](collector_dashboard_github_with_mcp/) | The dashboard, then **published to a GitHub repo + PR** | `mcp-config-dashboard-github.json` | `workflow-collector-dashboard-github.json` | + github |

## Shared configs

Reusable server definitions live in [`_shared_configs/`](_shared_configs/).

## Conventions

- **Tokens/keys** appear as `*_REPLACE_WITH_YOUR_*` placeholders - fill them in before running.
- **Absolute paths** in collector examples are stored as `__REPO_ROOT__` and resolved by `./setup.sh`.
- **`$ref`** moves data between nodes. Collector tools nest results under
  `$.structuredContent.data.api_response...`; AntV/filesystem/memory text results are
  at `$.content[0].text`; GitHub results are under `$.structuredContent...`.
