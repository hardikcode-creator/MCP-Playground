"""Entrypoint for the Prism Collection REST API (HTTP / Swagger).

Run with:  python rest_server.py

Then open Swagger UI at  http://localhost:8000/docs  and import the spec at
http://localhost:8000/openapi.json  into the Morpheus MCP generator.

Configure via env vars (see prism_api/config.py): PRISM_API_DB_DIR,
PRISM_API_DEFAULT_DB, PRISM_API_PUBLIC_URL, PRISM_API_HOST, PRISM_API_PORT.
"""

import uvicorn

from prism_api.app import app
from prism_api.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
