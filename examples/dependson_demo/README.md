# dependson_demo

Shows explicit ordering with `dependsOn`: nodes that don't exchange data can
still be forced to run in a chosen order (vs. parallel).

- Config: `../_shared_configs/mcp-config-multi.json` (provides the `everything` server)
- Workflow: `workflow-with-dependson.json`
- Prereq: Node.js >= 18
