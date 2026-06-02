# multi_mcp_tokens_demo

Two MCP servers in one workflow - the local `everything` server plus the
credential-backed `github` server (`search_repositories`, `search_code`) - to show
**multi-MCP orchestration** and **env-var token injection**.

- Config: `mcp-config-tokens.json` (this folder)
- Workflow: `workflow-multi-mcp-tokens.json`
- Prereqs:
  - Node.js >= 18
  - A GitHub Personal Access Token: replace `ghp_REPLACE_WITH_YOUR_TOKEN` in
    `mcp-config-tokens.json` (a read-only/public-scope token is enough for search).

> See `../_shared_configs/mcp-config-env-keys.json` for the same pattern extended
> to `tavily` and `firecrawl` API keys.
