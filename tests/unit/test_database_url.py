"""Alembic must run on the declared driver (psycopg2), whatever SQLAlchemy's default."""

import pytest

from app.core.database_url import sync_database_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql://u:p@h:5432/db", "postgresql+psycopg2://u:p@h:5432/db"),
        ("postgresql+asyncpg://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
        ("postgresql+psycopg://u@/db?host=/run", "postgresql+psycopg2://u@/db?host=/run"),
        ("postgres://u@h/db", "postgresql+psycopg2://u@h/db"),
        ("postgresql+psycopg2://u@h/db", "postgresql+psycopg2://u@h/db"),
    ],
)
def test_postgres_urls_use_psycopg2(url: str, expected: str) -> None:
    assert sync_database_url(url) == expected


@pytest.mark.parametrize("url", ["sqlite:///./test.db", "not a url"])
def test_other_urls_are_unchanged(url: str) -> None:
    assert sync_database_url(url) == url
