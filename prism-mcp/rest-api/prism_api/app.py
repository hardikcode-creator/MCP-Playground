"""FastAPI application factory for the Prism Collection REST API.

The app auto-generates an OpenAPI 3.1 spec at ``/openapi.json`` and Swagger UI
at ``/docs``. Point the Morpheus MCP generator at ``/openapi.json`` to build and
download an MCP server.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from prism_api.config import get_settings
from prism_api.routers import charts, clusters, databases, hosts, vms


def _operation_id(route: APIRoute) -> str:
    """Use the (unique) endpoint function name as the OpenAPI operationId.

    This yields clean tool names (e.g. ``get_cluster_perf``) when the spec is
    imported into the Morpheus MCP generator.
    """
    return route.name

DESCRIPTION = (
    "Read-only REST API over data collected by the Nutanix collector and stored "
    "in SQLite databases. Exposes cluster, host and VM static configuration plus "
    "historical and recent performance timeseries.\n\n"
    "Select which collected database to read with the `db` query parameter "
    "(see `GET /databases`); if omitted, the server's default database is used."
)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Nutanix Prism Collection API",
        description=DESCRIPTION,
        version="1.0.0",
        servers=[{"url": settings.public_url, "description": "Prism Collection API"}],
        generate_unique_id_function=_operation_id,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["health"])
    def health() -> dict:
        """Liveness check plus the active DB directory and default database."""
        return {
            "status": "ok",
            "db_dir": settings.db_dir,
            "default_db": settings.default_db,
        }

    app.include_router(databases.router)
    app.include_router(clusters.router)
    app.include_router(hosts.router)
    app.include_router(vms.router)
    app.include_router(charts.router)

    return app


app = create_app()
