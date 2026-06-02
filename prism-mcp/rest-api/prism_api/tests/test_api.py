"""Smoke tests for the Prism REST API against a collected sample database.

These tests require ``fastapi`` and ``httpx`` (the ``rest`` + ``dev`` extras) and
a collected ``*.db`` file present in the DB directory; otherwise they skip.
"""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from prism_api.app import app  # noqa: E402
from prism_api.config import get_settings  # noqa: E402

settings = get_settings()

pytestmark = pytest.mark.skipif(
    settings.default_db is None,
    reason="No collected *.db file available in the DB directory",
)

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_list_databases():
    resp = client.get("/databases")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list) and len(body) >= 1
    assert any(item["is_default"] for item in body)


def test_clusters_and_perf():
    resp = client.get("/clusters")
    assert resp.status_code == 200
    clusters = resp.json()
    assert len(clusters) >= 1

    moid = clusters[0]["moid"]
    detail = client.get(f"/clusters/{moid}")
    assert detail.status_code == 200
    assert detail.json()["moid"] == moid

    perf = client.get(f"/clusters/{moid}/perf")
    assert perf.status_code == 200
    perf_body = perf.json()
    assert perf_body["entity_type"] == "cluster"
    assert perf_body["entity_id"] == moid
    assert isinstance(perf_body["historical"], list)


def test_hosts():
    resp = client.get("/hosts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_vms_filter():
    resp = client.get("/vms", params={"power_state": "poweredOn"})
    assert resp.status_code == 200
    vms = resp.json()
    assert isinstance(vms, list)
    for vm in vms:
        assert vm["power_state"] == "poweredOn"


def test_metadata():
    resp = client.get("/metadata")
    assert resp.status_code in (200, 404)


def test_unknown_cluster_404():
    resp = client.get("/clusters/does-not-exist")
    assert resp.status_code == 404


def test_unknown_db_404():
    resp = client.get("/clusters", params={"db": "nope.db"})
    assert resp.status_code == 404


def _first_cluster_moid():
    return client.get("/clusters").json()[0]["moid"]


def test_cluster_line_chart():
    moid = _first_cluster_moid()
    resp = client.get(f"/charts/line/cluster/{moid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "line"
    groups = {p["group"] for p in body["data"]}
    assert {"cpu_utilization", "mem_utilization"} & groups
    for point in body["data"]:
        assert "time" in point and "value" in point and "group" in point
    # utilization metrics are scaled to percent, so the Y axis is labelled "%"
    # and every value is a sane percentage.
    assert body["axisYTitle"] == "%"
    assert all(0 <= p["value"] <= 100 for p in body["data"])


def test_cluster_line_chart_downsample():
    moid = _first_cluster_moid()
    resp = client.get(f"/charts/line/cluster/{moid}", params={"points": 5})
    assert resp.status_code == 200
    body = resp.json()
    # each metric series is capped to at most `points` timestamps.
    assert len({p["time"] for p in body["data"]}) <= 5


def test_cluster_capacity_pie_scaled_to_capacity_unit():
    moid = _first_cluster_moid()
    resp = client.get(f"/charts/pie/cluster/{moid}/capacity", params={"resource": "memory"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "pie"
    cats = {s["category"] for s in body["data"]}
    assert cats == {"Used", "Free"}
    # memory is a capacity metric (MiB), so the title is annotated with the unit.
    assert "(GiB)" in body["title"] or "(TiB)" in body["title"]


def test_clusters_comparison_pie():
    resp = client.get("/charts/pie/clusters/capacity", params={"resource": "storage"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["data"]) >= 1
    assert "(GiB)" in body["title"] or "(TiB)" in body["title"]


def test_clusters_comparison_pie_top_n():
    resp = client.get("/charts/pie/clusters/capacity", params={"resource": "storage", "top_n": 2})
    assert resp.status_code == 200
    assert len(resp.json()["data"]) <= 2


def test_storage_containers_pie_default_metric_and_top_n():
    moid = _first_cluster_moid()
    # the default metric must be "consumed" (the value the dashboard workflow uses).
    resp = client.get(f"/charts/pie/cluster/{moid}/storage-containers", params={"top_n": 3})
    assert resp.status_code == 200
    assert len(resp.json()["data"]) <= 3


def test_chart_bad_params():
    moid = _first_cluster_moid()
    assert client.get(f"/charts/line/cluster/{moid}", params={"dataset": "weekly"}).status_code == 400
    assert client.get(f"/charts/pie/cluster/{moid}/capacity", params={"resource": "foo"}).status_code == 400
    assert client.get("/charts/line/vm/does-not-exist").status_code == 404
    # the workflow's failing node used metric="storage_consumed"; only
    # consumed|capacity|freespace are valid, so that must be a 400.
    assert (
        client.get(
            f"/charts/pie/cluster/{moid}/storage-containers",
            params={"metric": "storage_consumed"},
        ).status_code
        == 400
    )
