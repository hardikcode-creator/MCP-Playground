"""Shared FastAPI dependencies / parameter definitions."""

from typing import Annotated, Optional

from fastapi import Query

DbParam = Annotated[
    Optional[str],
    Query(
        description=(
            "Collected SQLite DB filename to read (see GET /databases). "
            "If omitted, the server's default database is used."
        ),
        examples=["PC 2024.3 legacy.db"],
    ),
]
