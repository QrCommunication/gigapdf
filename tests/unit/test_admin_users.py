"""Admin user responses include identities from the Better Auth users table."""

from datetime import UTC, datetime
from types import SimpleNamespace

from app.api.v1.admin.users import get_user, list_users


class _Result:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar(self):
        return self._scalar

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Db:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _query):
        return self._results.pop(0)


def _quota():
    return SimpleNamespace(
        user_id="user-1",
        email=None,
        name=None,
        plan_type="free",
        storage_used_bytes=123,
        storage_limit_bytes=1000,
        document_count=4,
        api_calls_used=2,
        api_calls_limit=100,
        plan_expires_at=None,
        updated_at=datetime.now(UTC),
    )


async def test_list_users_joins_identity_and_document_count() -> None:
    db = _Db(
        [
            _Result(scalar=1),
            _Result(rows=[(_quota(), "alice@example.com", "Alice Doe", True)]),
        ]
    )

    response = await list_users(
        page=1,
        page_size=20,
        search="alice",
        plan_type=None,
        status=None,
        db=db,
    )

    assert response.total == 1
    assert response.users[0].email == "alice@example.com"
    assert response.users[0].name == "Alice Doe"
    assert response.users[0].document_count == 4
    assert response.users[0].email_verified is True


async def test_get_user_uses_quota_email_as_fallback() -> None:
    quota = _quota()
    quota.email = "fallback@example.com"
    db = _Db([_Result(rows=[(quota, None, None, False)])])

    response = await get_user("user-1", db=db)

    assert response.email == "fallback@example.com"
    assert response.name is None
