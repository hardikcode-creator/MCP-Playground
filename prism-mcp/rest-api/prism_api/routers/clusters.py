"""Cluster static + performance endpoints."""

from fastapi import APIRouter, HTTPException

from prism_api.db import fetch_all, fetch_one, open_db
from prism_api.deps import DbParam
from prism_api.models import Cluster, PerfResponse
from prism_api.perf import build_series

router = APIRouter(prefix="/clusters", tags=["clusters"])

_HISTORICAL_METRICS = [
    "cpu_utilization",
    "mem_utilization",
    "disk_utilization",
    "network_utilization",
]
_RECENT_METRICS = ["iops", "num_reads", "num_writes"]


@router.get("", response_model=list[Cluster])
def list_clusters(db: DbParam = None) -> list[Cluster]:
    """List all clusters (static configuration + capacity rollups)."""
    with open_db(db) as conn:
        rows = fetch_all(conn, "SELECT * FROM clusters ORDER BY name")
    return [Cluster(**row) for row in rows]


@router.get("/{cluster_moid}", response_model=Cluster)
def get_cluster(cluster_moid: str, db: DbParam = None) -> Cluster:
    """Get a single cluster's static detail by its ``moid``."""
    with open_db(db) as conn:
        row = fetch_one(conn, "SELECT * FROM clusters WHERE moid = ?", (cluster_moid,))
    if not row:
        raise HTTPException(status_code=404, detail=f"Cluster not found: {cluster_moid}")
    return Cluster(**row)


@router.get("/{cluster_moid}/perf", response_model=PerfResponse)
def get_cluster_perf(cluster_moid: str, db: DbParam = None) -> PerfResponse:
    """Get historical + recent performance timeseries for a cluster."""
    with open_db(db) as conn:
        historical_rows = fetch_all(
            conn,
            "SELECT * FROM cluster_historical_perf_stat "
            "WHERE cluster_id = ? ORDER BY timestamp",
            (cluster_moid,),
        )
        recent_rows = fetch_all(
            conn,
            "SELECT * FROM cluster_recent_perf_stat "
            "WHERE cluster_id = ? ORDER BY timestamp",
            (cluster_moid,),
        )
    return PerfResponse(
        entity_type="cluster",
        entity_id=cluster_moid,
        historical=build_series(historical_rows, _HISTORICAL_METRICS),
        recent=build_series(recent_rows, _RECENT_METRICS),
    )
