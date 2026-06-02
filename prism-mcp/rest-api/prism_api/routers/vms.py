"""VM static + performance endpoints."""

from fastapi import APIRouter, HTTPException, Query

from prism_api.db import fetch_all, fetch_one, open_db
from prism_api.deps import DbParam
from prism_api.models import PerfResponse, Vm
from prism_api.perf import build_series

router = APIRouter(prefix="/vms", tags=["vms"])

_HISTORICAL_METRICS = ["cpu_utilization", "mem_utilization"]
_RECENT_METRICS = ["iops", "num_reads", "num_writes", "cpu_readiness"]


@router.get("", response_model=list[Vm])
def list_vms(
    db: DbParam = None,
    host_id: str | None = Query(default=None, description="Filter VMs on this host."),
    cluster: str | None = Query(
        default=None, description="Filter VMs by cluster name (vms.cluster column)."
    ),
    power_state: str | None = Query(
        default=None, description="Filter by power state, e.g. 'poweredOn'."
    ),
) -> list[Vm]:
    """List VMs (static config + usage rollups), with optional filters."""
    clauses: list[str] = []
    params: list[str] = []
    if host_id:
        clauses.append("host_id = ?")
        params.append(host_id)
    if cluster:
        clauses.append("cluster = ?")
        params.append(cluster)
    if power_state:
        clauses.append("power_state = ?")
        params.append(power_state)

    query = "SELECT * FROM vms"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY name"

    with open_db(db) as conn:
        rows = fetch_all(conn, query, tuple(params))
    return [Vm(**row) for row in rows]


@router.get("/{vm_id}", response_model=Vm)
def get_vm(vm_id: str, db: DbParam = None) -> Vm:
    """Get a single VM's static detail by ``vm_id``."""
    with open_db(db) as conn:
        row = fetch_one(conn, "SELECT * FROM vms WHERE vm_id = ?", (vm_id,))
    if not row:
        raise HTTPException(status_code=404, detail=f"VM not found: {vm_id}")
    return Vm(**row)


@router.get("/{vm_id}/perf", response_model=PerfResponse)
def get_vm_perf(vm_id: str, db: DbParam = None) -> PerfResponse:
    """Get historical + recent performance timeseries for a VM."""
    with open_db(db) as conn:
        historical_rows = fetch_all(
            conn,
            "SELECT * FROM vm_historical_perf_stat WHERE vm_id = ? ORDER BY timestamp",
            (vm_id,),
        )
        recent_rows = fetch_all(
            conn,
            "SELECT * FROM vm_recent_perf_stat WHERE vm_id = ? ORDER BY timestamp",
            (vm_id,),
        )
    return PerfResponse(
        entity_type="vm",
        entity_id=vm_id,
        historical=build_series(historical_rows, _HISTORICAL_METRICS),
        recent=build_series(recent_rows, _RECENT_METRICS),
    )
