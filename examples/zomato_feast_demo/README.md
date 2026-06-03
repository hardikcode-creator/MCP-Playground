# zomato_feast_demo

Drives a **remote** MCP server (Zomato's hosted MCP, reached via `npx mcp-remote`)
across a 25-node workflow that fans out `get_restaurants_for_keyword` lookups. Shows
that the playground works with remote/hosted MCP servers, not just local `npx` ones.

- Config: `mcp-config-zomato.json` (this folder; also wires up `filesystem` + `everything`)
- Workflow: `workflow-zomato-feast-25.json`
- Prereq: Node.js >= 18 and network access to `https://mcp-server.zomato.com/mcp`
