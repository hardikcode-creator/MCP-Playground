"""Host static + performance endpoints."""

from fastapi import APIRouter, HTTPException, Query

from prism_api.db import fetch_all, fetch_one, open_db
from prism_api.deps import DbParam
from prism_api.models import Host, PerfResponse
from prism_api.perf import build_series

router = APIRouter(prefix="/hosts", tags=["hosts"])

_HISTORICAL_METRICS = [
    "cpu_utilization",
    "mem_utilization",
    "disk_utilization",
    "network_utilization",
]
_RECENT_METRICS = ["iops", "num_reads", "num_writes"]


@router.get("", response_model=list[Host])
def list_hosts(
    db: DbParam = None,
    cluster_moid: str | None = Query(
        default=None, description="Filter hosts belonging to this cluster moid."
    ),
) -> list[Host]:
    """List hosts (static hardware detail), optionally filtered by cluster."""
    query = "SELECT * FROM hosts"
    params: tuple = ()
    if cluster_moid:
        query += " WHERE cluster_moid = ?"
        params = (cluster_moid,)
    query += " ORDER BY host_name"
    with open_db(db) as conn:
        rows = fetch_all(conn, query, params)
    return [Host(**row) for row in rows]


@router.get("/{host_id}", response_model=Host)
def get_host(host_id: str, db: DbParam = None) -> Host:
    """Get a single host's static detail by ``host_id``."""
    with open_db(db) as conn:
        row = fetch_one(conn, "SELECT * FROM hosts WHERE host_id = ?", (host_id,))
    if not row:
        raise HTTPException(status_code=404, detail=f"Host not found: {host_id}")
    return Host(**row)


@router.get("/{host_id}/perf", response_model=PerfResponse)
def get_host_perf(host_id: str, db: DbParam = None) -> PerfResponse:
    """Get historical + recent performance timeseries for a host."""
    with open_db(db) as conn:
        historical_rows = fetch_all(
            conn,
            "SELECT * FROM host_historical_perf_stat "
            "WHERE host_id = ? ORDER BY timestamp",
            (host_id,),
        )
        recent_rows = fetch_all(
            conn,
            "SELECT * FROM host_recent_perf_stat "
            "WHERE host_id = ? ORDER BY timestamp",
            (host_id,),
        )
    return PerfResponse(
        entity_type="host",
        entity_id=host_id,
        historical=build_series(historical_rows, _HISTORICAL_METRICS),
        recent=build_series(recent_rows, _RECENT_METRICS),
    )
