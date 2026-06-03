"""Runtime configuration for the Prism REST API, sourced from environment vars."""

import os
from functools import lru_cache

PREFERRED_DEFAULT_DB = "PC 2024.3 legacy.db"


def _default_db_dir() -> str:
    """Directory that holds collected ``*.db`` files.

    Defaults to the ``collector-be`` directory (the parent of this package),
    which is where collected databases live.
    """
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Settings:
    """Configuration resolved from environment variables.

    Environment variables:
        PRISM_API_DB_DIR: Directory containing collected ``*.db`` files.
        PRISM_API_DEFAULT_DB: Default DB filename when a request omits ``db``.
        PRISM_API_PUBLIC_URL: Base URL advertised in the OpenAPI ``servers``
            block (used by Morpheus and generated MCP servers).
        PRISM_API_HOST / PRISM_API_PORT: Bind address for the server.
    """

    def __init__(self) -> None:
        self.db_dir: str = os.getenv("PRISM_API_DB_DIR", _default_db_dir())
        self.host: str = os.getenv("PRISM_API_HOST", "0.0.0.0")
        self.port: int = int(os.getenv("PRISM_API_PORT", "8000"))
        self.public_url: str = os.getenv(
            "PRISM_API_PUBLIC_URL", f"http://localhost:{self.port}"
        )
        self._configured_default_db: str | None = os.getenv("PRISM_API_DEFAULT_DB")

    def list_databases(self) -> list[str]:
        """Return the sorted list of ``*.db`` files in the DB directory."""
        try:
            return sorted(f for f in os.listdir(self.db_dir) if f.endswith(".db"))
        except OSError:
            return []

    @property
    def default_db(self) -> str | None:
        """DB filename used when a request does not specify ``db``."""
        if self._configured_default_db:
            return self._configured_default_db
        if os.path.isfile(os.path.join(self.db_dir, PREFERRED_DEFAULT_DB)):
            return PREFERRED_DEFAULT_DB
        databases = self.list_databases()
        return databases[0] if databases else None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
