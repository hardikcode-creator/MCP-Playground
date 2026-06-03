# Prism REST API

A read-only FastAPI service over collected Nutanix Prism **SQLite** databases. It
backs the Prism MCP server and exposes Swagger/OpenAPI for the Morpheus MCP
generator.

## Run (uv)

```bash
uv run python rest_server.py
# or, from the repo root:
uv run --directory prism-mcp/rest-api python rest_server.py
```

Then open:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI spec: `http://localhost:8000/openapi.json` (import this into the Morpheus MCP generator)

`uv` provisions the dependencies (`fastapi`, `uvicorn`, `pydantic`) from
`pyproject.toml` into an isolated environment on first run - no manual venv needed.

## Sample database

This folder ships with a sample collected database, `PC 2024.3 legacy.db`, which
is the preferred default. With it present, every endpoint works out of the box
with no configuration.

## Configuration (environment variables)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PRISM_API_DB_DIR` | Directory containing collected `*.db` files | this folder |
| `PRISM_API_DEFAULT_DB` | DB filename used when a request omits `?db=` | `PC 2024.3 legacy.db` if present, else first `*.db` found |
| `PRISM_API_PUBLIC_URL` | Base URL advertised in the OpenAPI `servers` block | `http://localhost:8000` |
| `PRISM_API_HOST` / `PRISM_API_PORT` | Bind address | `0.0.0.0` / `8000` |

To serve your own collected databases:

```bash
PRISM_API_DB_DIR=/path/to/your/dbs uv run python rest_server.py
```

## Endpoints (overview)

- Discovery: `GET /health`, `GET /databases`, `GET /metadata`
- Inventory: `GET /clusters`, `/clusters/{moid}`, `/hosts`, `/hosts/{id}`, `/vms`, `/vms/{id}`
- Performance: `.../perf` for clusters, hosts, and VMs
- Charts (unit-scaled, chart-ready): `GET /charts/line/...` and `GET /charts/pie/...`

## Tests

```bash
uv run --extra dev pytest
```

The tests run against the bundled sample database.
