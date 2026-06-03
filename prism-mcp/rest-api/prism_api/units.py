"""Unit-scaling helpers for the chart endpoints.

The collected Prism DB stores capacity columns (storage/memory/capacity and the
storage-container sizes) in **MiB**, and utilization metrics as a 0..100
percentage. Charts read far better when MiB is rolled up to GiB/TiB and values
carry an explicit unit. These helpers centralise that conversion. They are
intentionally heuristic and name-based so they work across the many
metric/column names without a hard-coded per-column table.
"""

from __future__ import annotations

from typing import Iterable, Sequence

_MIB_PER_GIB = 1024  # MiB in a GiB
_MIB_PER_TIB = 1024 * 1024  # MiB in a TiB

# Substrings that mark a value as a stored capacity (MiB) or a utilization
# percentage. Percent hints use the full word "utilization" on purpose: the
# substring "util" would also match capacity columns such as
# "utilized_memory"/"utilized_capacity".
_CAPACITY_HINTS = ("storage", "memory", "capacity", "freespace", "consumed", "space", "disk")
_PERCENT_HINTS = ("utilization", "readiness", "usage")


def is_capacity_metric(name: str) -> bool:
    """True when a metric/column name looks like a stored capacity (MiB)."""
    return any(hint in name.lower() for hint in _CAPACITY_HINTS)


def pick_capacity_unit(values_mib: Iterable[float | None]) -> tuple[float, str]:
    """Choose one (divisor, unit) for a set of MiB values from the largest.

    Using a single unit across a set (Used vs Free, or every cluster in a
    comparison) keeps slices comparable instead of mixing GiB and TiB.
    """
    nums = [v for v in values_mib if v is not None]
    if nums and max(nums) >= _MIB_PER_TIB:
        return _MIB_PER_TIB, "TiB"
    return _MIB_PER_GIB, "GiB"


def scale_capacity(values_mib: Sequence[float | None], divisor: float) -> list[float | None]:
    """Divide each MiB value by ``divisor`` (preserving ``None``) and round."""
    return [None if v is None else round(v / divisor, 2) for v in values_mib]


def scale_metric(name: str, value: float | None) -> tuple[float | None, str | None]:
    """Scale one timeseries metric value to a human unit based on its name.

    Returns ``(scaled_value, unit_label)``; ``unit_label`` is ``None`` for
    metrics with no natural unit (raw IOPS / counts).
    """
    if value is None:
        return None, None
    n = name.lower()
    if any(k in n for k in _PERCENT_HINTS):
        # Utilization is stored as 0..100 percent; only guard against a
        # parts-per-million encoding (values that exceed 100).
        pct = value / 10_000 if value > 100 else value
        return round(pct, 2), "%"
    if is_capacity_metric(n):
        divisor, unit = pick_capacity_unit([value])
        return round(value / divisor, 2), unit
    return round(value, 2), None


def combined_unit(units: Iterable[str | None]) -> str | None:
    """Pick a single axis-unit label from the per-metric units seen."""
    present = [u for u in units if u]
    if not present:
        return None
    uniq = list(dict.fromkeys(present))
    return uniq[0] if len(uniq) == 1 else " / ".join(uniq)


def downsample(rows: list, n: int) -> list:
    """Evenly downsample a list to at most ``n`` items by stride. ``n<=0`` = all."""
    if n is None or n <= 0 or len(rows) <= n:
        return rows
    step = len(rows) / n
    return [rows[int(i * step)] for i in range(n)]
