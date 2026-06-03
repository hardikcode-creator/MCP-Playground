# hello_world

The smallest possible workflow: an `everything__get-sum` feeding an
`everything__echo`. Good first run to confirm the playground, backend, and an
`npx` MCP server all work.

- Config: `../_shared_configs/mcp-config-multi.json` (provides the `everything` server)
- Workflow: `workflow-hello.json`
- Prereq: Node.js >= 18 (the `everything` server is fetched via `npx` on first run)
