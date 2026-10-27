"""Every PaginationInfo(...) built by a router must use the model's real fields.

Regression (2026-10-27): sharing.py and activity.py passed page_size= and
total_items= — pydantic rejected them on EVERY call, so /shared-with-me,
/shared-by-me and the activity feeds always answered 422 (the UI showed
"failed to load" even for a user with nothing shared).
"""

import ast
from pathlib import Path

import pytest

from app.schemas.responses.common import PaginationInfo

API_DIR = Path(__file__).resolve().parents[2] / "app" / "api"
ALLOWED_FIELDS = set(PaginationInfo.model_fields)
REQUIRED_FIELDS = {
    name for name, field in PaginationInfo.model_fields.items() if field.is_required()
}


def _pagination_calls() -> list[tuple[str, int, set[str]]]:
    calls = []
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "PaginationInfo"
            ):
                kwargs = {kw.arg for kw in node.keywords if kw.arg is not None}
                calls.append((path.name, node.lineno, kwargs))
    return calls


CALLS = _pagination_calls()


def test_routers_build_pagination_info() -> None:
    assert CALLS, "expected PaginationInfo usages under app/api"


@pytest.mark.parametrize(("filename", "lineno", "kwargs"), CALLS)
def test_pagination_info_uses_model_fields(
    filename: str, lineno: int, kwargs: set[str]
) -> None:
    unknown = kwargs - ALLOWED_FIELDS
    missing = REQUIRED_FIELDS - kwargs

    assert not unknown, f"{filename}:{lineno} unknown PaginationInfo fields {unknown}"
    assert not missing, f"{filename}:{lineno} missing PaginationInfo fields {missing}"
