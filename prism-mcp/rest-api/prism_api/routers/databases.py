"""Endpoints for discovering collected databases and collection metadata."""

import os

from fastapi import APIRouter, HTTPException

from prism_api.config import get_settings
from prism_api.db import count_rows, fetch_one, open_db
from prism_api.deps import DbParam
from prism_api.models import DatabaseInfo, Metadata

router = APIRouter(tags=["databases"])

_COUNT_TABLES = ["data_centers", "clusters", "hosts", "vms", "storage_containers"]


@router.get("/databases", response_model=list[DatabaseInfo])
def list_databases() -> list[DatabaseInfo]:
    """List collected ``*.db`` files available to the API.

    Use the returned ``name`` as the ``db`` query parameter on other endpoints.
    """
    settings = get_settings()
    default_db = settings.default_db
    results: list[DatabaseInfo] = []

    for name in settings.list_databases():
        info = DatabaseInfo(name=name, is_default=(name == default_db))
        path = os.path.join(settings.db_dir, name)
        try:
            info.size_bytes = os.path.getsize(path)
        except OSError:
            pass
        try:
            with open_db(name) as conn:
                info.counts = {t: count_rows(conn, t) for t in _COUNT_TABLES}
                meta = fetch_one(conn, "SELECT * FROM meta_data LIMIT 1")
                if meta:
                    info.source = meta.get("source")
                    info.hypervisor = meta.get("hypervisor")
                    info.collection_datetime = meta.get("collection_datetime")
        except Exception as exc:  # noqa: BLE001 - report per-file, don't fail all
            info.error = str(exc)
        results.append(info)

    return results


@router.get("/metadata", response_model=Metadata)
def get_metadata(db: DbParam = None) -> Metadata:
    """Return collection metadata (``meta_data`` table) for the selected DB."""
    with open_db(db) as conn:
        meta = fetch_one(conn, "SELECT * FROM meta_data LIMIT 1")
    if not meta:
        raise HTTPException(status_code=404, detail="No metadata found in database")
    return Metadata(**meta)
