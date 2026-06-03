# everything_demo

Exercises the `@modelcontextprotocol/server-everything` reference server across a
25-node workflow (`echo`, `get-sum`, ...). A broad smoke test of tool-calling and
data flow without any external credentials.

- Config: `../_shared_configs/mcp-config-multi.json` (provides the `everything` server)
- Workflow: `workflow-everything-25.json`
- Prereq: Node.js >= 18
