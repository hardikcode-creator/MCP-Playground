# multi_layered_demo

A 25-node, multi-layer DAG built on the `everything` server. Demonstrates how the
executor schedules many nodes across dependency layers (fan-out / fan-in) and how
`$ref` carries values between them.

- Config: `../_shared_configs/mcp-config-multi.json` (provides the `everything` server)
- Workflow: `workflow-multi-layered-25.json`
- Prereq: Node.js >= 18
