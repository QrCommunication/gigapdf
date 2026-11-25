"""Storage metrics must use the configured backend and count every object."""

from unittest.mock import patch

from app.services.infra_metrics_service import InfraMetricsService
from app.storage_backends.base import StoredObject


class _Backend:
    def __init__(self, objects):
        self.objects = objects

    def iter_objects(self):
        yield from self.objects


class _BrokenBackend:
    def iter_objects(self):
        raise RuntimeError("storage unavailable")


def test_s3_metrics_use_storage_backend_inventory() -> None:
    backend = _Backend(
        [
            StoredObject(key="documents/a.pdf", size=123),
            StoredObject(key="thumbnails/a.png", size=456),
            StoredObject(key="backups/postgres/daily.sql.gz", size=789),
        ]
    )
    with patch(
        "app.services.infra_metrics_service.get_storage_backend",
        return_value=backend,
    ):
        metrics = InfraMetricsService().collect_current_metrics()

    assert metrics["s3_objects_count"] == 3
    assert metrics["s3_total_bytes"] == 1368


def test_s3_metrics_fail_closed_on_backend_error() -> None:
    with patch(
        "app.services.infra_metrics_service.get_storage_backend",
        return_value=_BrokenBackend(),
    ):
        metrics = InfraMetricsService().collect_current_metrics()

    assert metrics["s3_objects_count"] is None
    assert metrics["s3_total_bytes"] is None
