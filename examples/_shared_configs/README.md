# _shared_configs

MCP configs reused by several examples (kept here to avoid duplicating the same
server definitions in every demo folder).

| File | Servers | Used by |
| --- | --- | --- |
| `mcp-config-multi.json` | `everything` | `hello_world`, `breakpoints_demo`, `dependson_demo`, `multi_layered_demo`, `everything_demo` |
| `mcp-config-env-keys.json` | `github`, `tavily`, `firecrawl` | reference for env-var/API-key injection |
| `mcp-config-airbnb-zomato.json` | `airbnb`, `zomato-mcp` | reference for `npx` + remote (`mcp-remote`) servers |

Replace any `*_REPLACE_WITH_YOUR_*` placeholder with a real token/key before use.
