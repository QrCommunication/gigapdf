"""S3 access-log parsing and monthly bandwidth pricing tests."""

from types import SimpleNamespace
from unittest.mock import patch

from app.services.bandwidth_service import S3BandwidthService


def _line(operation: str, status: int, size: int, key: str, timestamp: str) -> str:
    return (
        f'owner gigapdf [{timestamp}] 192.0.2.1 - request-id {operation} {key} '
        f'/{key} {status} - {size} {size} 10 5 - agent -'
    )


def test_access_log_is_aggregated_by_month_and_user() -> None:
    content = "\n".join(
        [
            _line("REST.GET.OBJECT", 200, 100, "documents/user-1/v1.pdf", "25/Nov/2026:10:00:00 +0000"),
            _line("REST.GET.OBJECT", 206, 50, "thumbnails/user-1/v1.png", "25/Nov/2026:10:01:00 +0000"),
            _line("REST.GET.OBJECT", 200, 25, "documents/user-2/v2.pdf", "01/Oct/2026:10:02:00 +0000"),
            _line("REST.HEAD.OBJECT", 200, 999, "documents/user-1/v1.pdf", "25/Nov/2026:10:03:00 +0000"),
            _line("REST.GET.OBJECT", 404, 999, "documents/user-1/missing.pdf", "25/Nov/2026:10:04:00 +0000"),
        ]
    )

    totals = S3BandwidthService.parse_access_log(content)
    users = S3BandwidthService.parse_user_access_log(content)

    assert totals == {"2026-11": (150, 2), "2026-10": (25, 1)}
    assert users == {("2026-11", "user-1"): 150, ("2026-10", "user-2"): 25}


class _Result:
    def __init__(self, record=None, rows=None):
        self.record = record
        self.rows = rows or []

    def scalar_one_or_none(self):
        return self.record

    def __iter__(self):
        return iter(self.rows)


class _Session:
    def __init__(self, result):
        self.result = result

    def execute(self, _query):
        return self.result


class _Context:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *_args):
        return False


def test_cost_uses_started_tb_and_only_excess_bandwidth() -> None:
    record = SimpleNamespace(storage_bytes=2_000_000_000_000, downloaded_bytes=7_000_000_000_000)
    service = S3BandwidthService()
    with patch(
        "app.services.bandwidth_service.get_sync_session",
        return_value=_Context(_Session(_Result(record=record))),
    ):
        cost = service.get_cost_for_period("2026-11")

    assert cost["free_bandwidth_bytes"] == 6_000_000_000_000
    assert cost["bandwidth_overage_bytes"] == 1_000_000_000_000
    assert cost["bandwidth_overage_usd"] == 10.0
    assert cost["storage_tb_started"] == 2
    assert cost["storage_cost_eur"] == 10.0
    assert cost["hosting_cost_eur"] == 10.0


def test_per_user_cost_contains_identity_and_no_hosting_allocation() -> None:
    quota = SimpleNamespace(user_id="user-1", storage_used_bytes=1_000_000_000_000, email=None)
    result = _Result(rows=[(quota, "user@example.com", "User", 4_000_000_000_000)])
    service = S3BandwidthService()
    with patch(
        "app.services.bandwidth_service.get_sync_session",
        return_value=_Context(_Session(result)),
    ):
        users = service.get_user_costs("2026-11")

    assert users[0]["email"] == "user@example.com"
    assert users[0]["storage_cost_eur"] == 5.0
    assert users[0]["bandwidth_overage_usd"] == 10.0
    assert "hosting_cost_eur" not in users[0]
