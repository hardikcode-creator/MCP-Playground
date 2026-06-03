"""Pydantic response models mirroring the collected Prism DB schema.

All entity fields are optional because collected rows frequently contain NULLs,
and ``extra='allow'`` lets any additional columns pass through unmodified so the
API stays resilient to schema drift across collector versions.
"""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator


class PrismModel(BaseModel):
    """Base model: lenient, passes through unknown columns, normalises empties."""

    model_config = ConfigDict(extra="allow")

    @field_validator("*", mode="before")
    @classmethod
    def _empty_string_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and value == "":
            return None
        return value


class Cluster(PrismModel):
    data_center_moid: Optional[str] = None
    moid: Optional[str] = None
    name: Optional[str] = None
    memory: Optional[float] = None
    utilized_memory: Optional[float] = None
    cores: Optional[int] = None
    capacity: Optional[float] = None
    utilized_capacity: Optional[float] = None
    cpu: Optional[float] = None
    utilized_cpu: Optional[float] = None
    disk_usage_95_percentile: Optional[float] = None
    daily_average_read_write: Optional[float] = None
    cpu_usage_95_percentile: Optional[float] = None
    memory_usage_95_percentile: Optional[float] = None
    iops_95_percentile: Optional[float] = None
    num_reads_95_percentile: Optional[float] = None
    num_writes_95_percentile: Optional[float] = None
    storage_capacity: Optional[float] = None
    storage_consumed: Optional[float] = None
    storage_freespace: Optional[float] = None
    ntp_servers: Optional[str] = None
    cluster_ip: Optional[str] = None
    iscsi_ip: Optional[str] = None
    dns_servers: Optional[str] = None


class Host(PrismModel):
    cluster_moid: Optional[str] = None
    host_id: Optional[str] = None
    ip: Optional[str] = None
    host_name: Optional[str] = None
    model: Optional[str] = None
    nics: Optional[int] = None
    bios: Optional[str] = None
    vendor: Optional[str] = None
    cpus: Optional[int] = None
    vms: Optional[int] = None
    cpu_model: Optional[str] = None
    cpu_cores: Optional[int] = None
    cpu_speed: Optional[float] = None
    cores_per_cpu: Optional[int] = None
    memory: Optional[float] = None
    disk_usage_95_percentile: Optional[float] = None
    daily_average_read_write: Optional[float] = None
    cpu_usage_95_percentile: Optional[float] = None
    mem_usage_95_percentile: Optional[float] = None
    iops_95_percentile: Optional[float] = None
    num_reads_95_percentile: Optional[float] = None
    num_writes_95_percentile: Optional[float] = None
    hdd_config: Optional[str] = None
    ssd_config: Optional[str] = None
    total_space_MiB: Optional[float] = None
    used_space_MiB: Optional[float] = None
    gpu_count: Optional[int] = None
    gpu_name: Optional[str] = None
    gpu_vendor: Optional[str] = None
    gpu_memory_size: Optional[float] = None
    hypervisor: Optional[str] = None
    storage_capacity: Optional[float] = None
    storage_consumed: Optional[float] = None
    storage_freespace: Optional[float] = None
    maintenance_mode: Optional[bool] = None
    service_tag: Optional[str] = None


class Vm(PrismModel):
    host_id: Optional[str] = None
    vm_id: Optional[str] = None
    uuid: Optional[str] = None
    name: Optional[str] = None
    vm_sizing: Optional[str] = None
    power_state: Optional[str] = None
    memory: Optional[float] = None
    cores: Optional[int] = None
    thin_provisioned: Optional[str] = None
    snapshot: Optional[float] = None
    guest_os: Optional[str] = None
    max_cpu: Optional[int] = None
    overall_cpu: Optional[int] = None
    cluster: Optional[str] = None
    workload_type: Optional[str] = None
    template: Optional[str] = None
    iops_95_percentile: Optional[float] = None
    num_reads_95_percentile: Optional[float] = None
    num_writes_95_percentile: Optional[float] = None
    average_cpu_usage: Optional[float] = None
    median_cpu_usage: Optional[float] = None
    peak_cpu_usage: Optional[float] = None
    cpu_usage_95_percentile: Optional[float] = None
    average_memory_usage: Optional[float] = None
    median_memory_usage: Optional[float] = None
    peak_memory_usage: Optional[float] = None
    memory_usage_95_percentile: Optional[float] = None
    connection_state: Optional[str] = None
    firmware: Optional[str] = None
    efi_secure_boot: Optional[bool] = None
    hw_version: Optional[int] = None
    ft_state: Optional[str] = None
    resource_pool: Optional[str] = None
    cpu_limit: Optional[float] = None
    cpu_reservation: Optional[float] = None
    memory_limit: Optional[float] = None
    memory_reservation: Optional[float] = None
    cpu_readiness_95_percentile: Optional[float] = None
    tool_status: Optional[str] = None
    fixed_passthru_hotplug: Optional[bool] = None
    snapshot_length: Optional[int] = None
    cbt: Optional[bool] = None
    creation_time: Optional[str] = None
    cdrom_status: Optional[str] = None


class Metadata(PrismModel):
    source: Optional[str] = None
    ip_address: Optional[str] = None
    bundle_version: Optional[str] = None
    hypervisor: Optional[str] = None
    connection_mode: Optional[str] = None
    os: Optional[str] = None
    hypervisor_version: Optional[str] = None
    port: Optional[str] = None
    cli_extract: Optional[bool] = None
    collection_datetime: Optional[str] = None
    performance_duration: Optional[str] = None
    source_version: Optional[str] = None
    is_anonymized: Optional[bool] = None


class DatabaseInfo(PrismModel):
    """Summary of one collected ``*.db`` file."""

    name: str
    size_bytes: Optional[int] = None
    is_default: bool = False
    source: Optional[str] = None
    hypervisor: Optional[str] = None
    collection_datetime: Optional[str] = None
    counts: dict[str, int] = {}
    error: Optional[str] = None


class PerfPoint(PrismModel):
    """A single timeseries sample."""

    timestamp: Optional[str] = None
    value: Optional[float] = None


class PerfSeries(PrismModel):
    """A named metric timeseries (e.g. ``cpu_utilization``)."""

    metric: str
    points: list[PerfPoint] = []


class PerfResponse(PrismModel):
    """Performance data for a single entity, split into historical and recent."""

    entity_type: str
    entity_id: str
    historical: list[PerfSeries] = []
    recent: list[PerfSeries] = []


class ChartLinePoint(PrismModel):
    """One line-chart datapoint. Field names match AntV ``generate_line_chart``."""

    time: Optional[str] = None
    value: Optional[float] = None
    group: Optional[str] = None  # metric name -> a separate line per group


class ChartLine(PrismModel):
    """Line-chart-ready payload (performance over time).

    ``data`` can be passed straight to the AntV ``generate_line_chart`` tool, or
    pivoted (labels + datasets) for QuickChart/Chart.js.
    """

    type: str = "line"
    title: str
    axisXTitle: str = "time"
    axisYTitle: Optional[str] = None
    data: list[ChartLinePoint] = []


class ChartPieSlice(PrismModel):
    """One pie slice. Field names match AntV ``generate_pie_chart``."""

    category: str
    value: Optional[float] = None


class ChartPie(PrismModel):
    """Pie-chart-ready payload (capacity breakdown)."""

    type: str = "pie"
    title: str
    data: list[ChartPieSlice] = []
