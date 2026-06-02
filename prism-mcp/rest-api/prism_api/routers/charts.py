"""Chart-ready endpoints for visualization MCPs.

Line endpoints emit performance timeseries in AntV ``generate_line_chart`` shape
(``data: [{time, value, group}]``); pie endpoints emit capacity breakdowns in
AntV ``generate_pie_chart`` shape (``data: [{category, value}]``). Both map
trivially to QuickChart/Chart.js (labels + datasets).
"""

from fastapi import APIRouter, HTTPException, Query

from prism_api.db import fetch_all, fetch_one, open_db, to_float
from prism_api.deps import DbParam
from prism_api.models import ChartLine, ChartLinePoint, ChartPie, ChartPieSlice
from prism_api.units import (
    combined_unit,
    downsample,
    pick_capacity_unit,
    scale_capacity,
    scale_metric,
)

router = APIRouter(prefix="/charts", tags=["charts"])

# entity -> how to resolve its display name and id column.
_ENTITY = {
    "cluster": {"table": "clusters", "name_col": "name", "id_col": "moid"},
    "host": {"table": "hosts", "name_col": "host_name", "id_col": "host_id"},
    "vm": {"table": "vms", "name_col": "name", "id_col": "vm_id"},
}

# (entity, dataset) -> perf-stat table name.
_PERF_TABLE = {
    ("cluster", "historical"): "cluster_historical_perf_stat",
    ("cluster", "recent"): "cluster_recent_perf_stat",
    ("host", "historical"): "host_historical_perf_stat",
    ("host", "recent"): "host_recent_perf_stat",
    ("vm", "historical"): "vm_historical_perf_stat",
    ("vm", "recent"): "vm_recent_perf_stat",
}
_PERF_ID_COL = {"cluster": "cluster_id", "host": "host_id", "vm": "vm_id"}

# default metrics per (entity, dataset) for a clean, comparable line chart.
_DEFAULT_METRICS = {
    ("cluster", "historical"): ["cpu_utilization", "mem_utilization"],
    ("cluster", "recent"): ["iops", "num_reads", "num_writes"],
    ("host", "historical"): ["cpu_utilization", "mem_utilization"],
    ("host", "recent"): ["iops", "num_reads", "num_writes"],
    ("vm", "historical"): ["cpu_utilization", "mem_utilization"],
    ("vm", "recent"): ["iops", "num_reads", "num_writes", "cpu_readiness"],
}

# cluster capacity "used" columns for the cross-cluster comparison pie.
_CLUSTER_RESOURCE_COL = {
    "storage": "storage_consumed",
    "logical": "utilized_capacity",
    "memory": "utilized_memory",
    "cpu": "utilized_cpu",
}

_DatasetQuery = Query(
    default="historical",
    description="Which perf table to chart: 'historical' (utilization) or 'recent' (iops).",
)
_MetricsQuery = Query(
    default=None,
    description="Comma-separated metric columns to plot; defaults per entity/dataset.",
)
_PointsQuery = Query(
    default=0,
    ge=0,
    description="Downsample each series to at most N points for a cleaner line (0 = all).",
)
_TopNQuery = Query(
    default=0,
    ge=0,
    description="Keep only the N largest slices (0 = all).",
)


def _line_chart(
    db: str | None,
    entity: str,
    entity_id: str,
    dataset: str,
    metrics_csv: str | None,
    points: int = 0,
) -> ChartLine:
    if dataset not in ("historical", "recent"):
        raise HTTPException(status_code=400, detail="dataset must be 'historical' or 'recent'")

    cfg = _ENTITY[entity]
    metrics = (
        [m.strip() for m in metrics_csv.split(",") if m.strip()]
        if metrics_csv
        else _DEFAULT_METRICS[(entity, dataset)]
    )
    table = _PERF_TABLE[(entity, dataset)]
    id_col = _PERF_ID_COL[entity]

    with open_db(db) as conn:
        ent = fetch_one(
            conn,
            f"SELECT {cfg['name_col']} AS nm FROM {cfg['table']} WHERE {cfg['id_col']} = ?",
            (entity_id,),
        )
        if not ent:
            raise HTTPException(status_code=404, detail=f"{entity} not found: {entity_id}")
        rows = fetch_all(
            conn, f"SELECT * FROM {table} WHERE {id_col} = ? ORDER BY timestamp", (entity_id,)
        )

    rows = downsample(rows, points)
    name = ent.get("nm") or entity_id
    data: list[ChartLinePoint] = []
    units: list[str | None] = []
    for metric in metrics:
        for row in rows:
            scaled, unit = scale_metric(metric, to_float(row.get(metric)))
            if scaled is not None:
                data.append(ChartLinePoint(time=row.get("timestamp"), value=scaled, group=metric))
                units.append(unit)

    unit = combined_unit(units)
    return ChartLine(
        title=f"{name} - {dataset} performance" + (f" ({unit})" if unit else ""),
        axisXTitle="time",
        axisYTitle=unit or ", ".join(metrics),
        data=data,
    )


def _used_free_slices(used: float | None, free: float | None) -> list[ChartPieSlice]:
    slices: list[ChartPieSlice] = []
    if used is not None:
        slices.append(ChartPieSlice(category="Used", value=used))
    if free is not None:
        slices.append(ChartPieSlice(category="Free", value=free))
    return slices


def _scale_used_free(
    used: float | None, free: float | None, label: str, is_capacity: bool
) -> tuple[float | None, float | None, str]:
    """Scale a Used/Free pair to one shared unit and annotate the label."""
    if is_capacity:
        divisor, unit = pick_capacity_unit([used, free])
        used, free = scale_capacity([used, free], divisor)
        return used, free, f"{label} ({unit})"
    used = round(used, 2) if used is not None else None
    free = round(free, 2) if free is not None else None
    return used, free, label


def _top_n(pairs: list[tuple[str, float]], n: int) -> list[tuple[str, float]]:
    """Keep only the N largest (category, value) pairs; ``n<=0`` keeps all."""
    if n and n > 0 and len(pairs) > n:
        return sorted(pairs, key=lambda p: p[1], reverse=True)[:n]
    return pairs


def _comparison_pie(
    rows: list[dict], is_capacity: bool, top_n: int, title_base: str
) -> ChartPie:
    """Build a comparison pie from name/value rows, capacity-scaling if needed."""
    pairs = [(r.get("name") or "?", to_float(r.get("v"))) for r in rows]
    pairs = [(c, v) for c, v in pairs if v is not None]
    unit = None
    if is_capacity:
        divisor, unit = pick_capacity_unit([v for _, v in pairs])
        pairs = [(c, round(v / divisor, 2)) for c, v in pairs]
    pairs = _top_n(pairs, top_n)
    return ChartPie(
        title=title_base + (f" ({unit})" if unit else ""),
        data=[ChartPieSlice(category=c, value=v) for c, v in pairs],
    )


def _cluster_capacity(row: dict, resource: str) -> tuple[float | None, float | None, str, bool]:
    if resource == "storage":
        return (
            to_float(row.get("storage_consumed")),
            to_float(row.get("storage_freespace")),
            "storage",
            True,
        )
    totals = {
        "logical": ("capacity", "utilized_capacity", "logical capacity", True),
        "memory": ("memory", "utilized_memory", "memory", True),
        "cpu": ("cpu", "utilized_cpu", "cpu", False),
    }
    if resource not in totals:
        raise HTTPException(
            status_code=400,
            detail="resource must be one of: storage, logical, memory, cpu",
        )
    total_col, used_col, label, is_capacity = totals[resource]
    total = to_float(row.get(total_col))
    used = to_float(row.get(used_col))
    free = total - used if total is not None and used is not None else None
    return used, free, label, is_capacity


@router.get("/line/cluster/{moid}", response_model=ChartLine)
def cluster_line_chart(
    moid: str,
    dataset: str = _DatasetQuery,
    metrics: str | None = _MetricsQuery,
    points: int = _PointsQuery,
    db: DbParam = None,
) -> ChartLine:
    """Line-chart-ready performance timeseries for a cluster."""
    return _line_chart(db, "cluster", moid, dataset, metrics, points)


@router.get("/line/host/{host_id}", response_model=ChartLine)
def host_line_chart(
    host_id: str,
    dataset: str = _DatasetQuery,
    metrics: str | None = _MetricsQuery,
    points: int = _PointsQuery,
    db: DbParam = None,
) -> ChartLine:
    """Line-chart-ready performance timeseries for a host."""
    return _line_chart(db, "host", host_id, dataset, metrics, points)


@router.get("/line/vm/{vm_id}", response_model=ChartLine)
def vm_line_chart(
    vm_id: str,
    dataset: str = _DatasetQuery,
    metrics: str | None = _MetricsQuery,
    points: int = _PointsQuery,
    db: DbParam = None,
) -> ChartLine:
    """Line-chart-ready performance timeseries for a VM."""
    return _line_chart(db, "vm", vm_id, dataset, metrics, points)


@router.get("/pie/cluster/{moid}/capacity", response_model=ChartPie)
def cluster_capacity_pie(
    moid: str,
    resource: str = Query(
        default="storage", description="Capacity to break down: storage|logical|memory|cpu."
    ),
    db: DbParam = None,
) -> ChartPie:
    """Pie of Used vs Free capacity for one cluster."""
    with open_db(db) as conn:
        cluster = fetch_one(conn, "SELECT * FROM clusters WHERE moid = ?", (moid,))
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster not found: {moid}")
    used, free, label, is_capacity = _cluster_capacity(cluster, resource)
    used, free, label = _scale_used_free(used, free, label, is_capacity)
    return ChartPie(
        title=f"{cluster.get('name') or moid} - {label} used vs free",
        data=_used_free_slices(used, free),
    )


@router.get("/pie/host/{host_id}/capacity", response_model=ChartPie)
def host_capacity_pie(host_id: str, db: DbParam = None) -> ChartPie:
    """Pie of Used vs Free storage for one host."""
    with open_db(db) as conn:
        host = fetch_one(conn, "SELECT * FROM hosts WHERE host_id = ?", (host_id,))
    if not host:
        raise HTTPException(status_code=404, detail=f"Host not found: {host_id}")
    used = to_float(host.get("storage_consumed"))
    free = to_float(host.get("storage_freespace"))
    used, free, label = _scale_used_free(used, free, "storage", True)
    return ChartPie(
        title=f"{host.get('host_name') or host_id} - {label} used vs free",
        data=_used_free_slices(used, free),
    )


@router.get("/pie/clusters/capacity", response_model=ChartPie)
def clusters_capacity_pie(
    resource: str = Query(
        default="storage", description="Consumed metric to compare: storage|logical|memory|cpu."
    ),
    top_n: int = _TopNQuery,
    db: DbParam = None,
) -> ChartPie:
    """Pie comparing consumed capacity across all clusters."""
    column = _CLUSTER_RESOURCE_COL.get(resource)
    if not column:
        raise HTTPException(
            status_code=400, detail="resource must be one of: storage, logical, memory, cpu"
        )
    with open_db(db) as conn:
        rows = fetch_all(conn, f"SELECT name, {column} AS v FROM clusters ORDER BY name")
    return _comparison_pie(rows, resource != "cpu", top_n, f"Clusters by {resource} consumed")


@router.get("/pie/cluster/{moid}/storage-containers", response_model=ChartPie)
def cluster_storage_containers_pie(
    moid: str,
    metric: str = Query(default="consumed", description="Slice value: consumed|capacity|freespace."),
    top_n: int = _TopNQuery,
    db: DbParam = None,
) -> ChartPie:
    """Pie of storage containers in a cluster, sized by the chosen metric."""
    if metric not in ("consumed", "capacity", "freespace"):
        raise HTTPException(
            status_code=400, detail="metric must be one of: consumed, capacity, freespace"
        )
    with open_db(db) as conn:
        rows = fetch_all(
            conn,
            f"SELECT name, {metric} AS v FROM storage_containers WHERE cluster_id = ? ORDER BY name",
            (moid,),
        )
    return _comparison_pie(rows, True, top_n, f"Storage containers by {metric}")
