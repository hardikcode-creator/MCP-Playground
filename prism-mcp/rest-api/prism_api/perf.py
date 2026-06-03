"""Helpers to shape perf-stat rows into named timeseries."""

from typing import Any

from prism_api.db import to_float
from prism_api.models import PerfPoint, PerfSeries


def build_series(rows: list[dict[str, Any]], metrics: list[str]) -> list[PerfSeries]:
    """Build one :class:`PerfSeries` per metric column from perf-stat rows.

    Samples whose metric value is NULL/empty/non-numeric are skipped so each
    series only contains real datapoints.
    """
    series: list[PerfSeries] = []
    for metric in metrics:
        points = [
            PerfPoint(timestamp=row.get("timestamp"), value=to_float(row.get(metric)))
            for row in rows
            if to_float(row.get(metric)) is not None
        ]
        series.append(PerfSeries(metric=metric, points=points))
    return series
