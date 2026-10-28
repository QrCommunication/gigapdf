"""Database URL helpers shared by the app and the Alembic environment."""

_POSTGRES_SCHEMES = ("postgresql", "postgres")


def sync_database_url(url: str) -> str:
    """Return *url* with the synchronous PostgreSQL driver Alembic runs on.

    The driver is named explicitly (psycopg2, declared in requirements.txt).
    A bare ``postgresql://`` lets SQLAlchemy pick its default, which became
    psycopg (v3) in SQLAlchemy 2.1: migrations then only worked where psycopg
    happened to be installed outside requirements.txt, and failed in CI with
    ``ModuleNotFoundError: No module named 'psycopg'``.

    Non-PostgreSQL URLs are returned unchanged.
    """
    scheme, separator, rest = url.partition("://")
    if not separator or scheme.split("+", 1)[0] not in _POSTGRES_SCHEMES:
        return url
    return f"postgresql+psycopg2://{rest}"
