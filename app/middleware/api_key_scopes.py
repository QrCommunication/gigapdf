"""
Scope rules for secret API keys (``giga_pk_*`` sent as ``X-API-Key``).

This module is the single source of truth for "which scope does this request
need?". It is pure (no I/O, no framework objects) so the rule can be unit
tested exhaustively and reused by the middleware and the documentation.

Rules
-----
- Platform administration (``/api/v1/admin/...``) is never reachable with an
  API key, whatever its scopes: an API key never carries platform-admin rights.
- API-key management (``/api/v1/api-keys``) and billing (``/api/v1/billing``)
  require the ``admin`` scope, for every method. A leaked ``read``/``write``
  key therefore cannot mint new keys or touch the subscription.
- Every other route requires ``read`` for safe methods (GET, HEAD, OPTIONS)
  and ``write`` for every other method.

Scopes are nested: ``read`` ⊂ ``write`` ⊂ ``admin``. A ``write`` key can read
what it writes, and ``admin`` is full access (minus platform administration),
as the scope table of the API documentation has always stated.
"""

from __future__ import annotations

SCOPE_READ = "read"
SCOPE_WRITE = "write"
SCOPE_ADMIN = "admin"

SAFE_METHODS: frozenset[str] = frozenset({"GET", "HEAD", "OPTIONS"})

# Route prefixes that require the ``admin`` scope regardless of the method.
ADMIN_SCOPE_PREFIXES: tuple[str, ...] = (
    "/api/v1/api-keys",
    "/api/v1/billing",
)

# Route prefixes that an API key can never reach: platform administration,
# and the caller's own account (erasure needs the account holder's session,
# whatever the key's scopes — the route also checks auth_method).
API_KEY_FORBIDDEN_PREFIXES: tuple[str, ...] = ("/api/v1/admin", "/api/v1/account")


def _matches_prefix(path: str, prefix: str) -> bool:
    """True when *path* is *prefix* itself or a sub-path of it (segment-aware)."""
    return path == prefix or path.startswith(prefix + "/")


# Each scope with every scope it grants: read ⊂ write ⊂ admin.
SCOPE_GRANTS: dict[str, frozenset[str]] = {
    SCOPE_READ: frozenset({SCOPE_READ}),
    SCOPE_WRITE: frozenset({SCOPE_READ, SCOPE_WRITE}),
    SCOPE_ADMIN: frozenset({SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN}),
}


def parse_scopes(raw_scopes: str | None) -> frozenset[str]:
    """Split the comma-separated ``ApiKey.scopes`` column into a set of scopes."""
    if not raw_scopes:
        return frozenset()
    return frozenset(s.strip() for s in raw_scopes.split(",") if s.strip())


def granted_scopes(raw_scopes: str | None) -> frozenset[str]:
    """Every scope a key holds, implied ones included (unknown names grant nothing)."""
    granted: frozenset[str] = frozenset()
    for scope in parse_scopes(raw_scopes):
        granted |= SCOPE_GRANTS.get(scope, frozenset())
    return granted


def required_api_key_scope(method: str, path: str) -> str | None:
    """
    Return the scope a secret API key needs to call ``method path``.

    Args:
        method: HTTP method (any case).
        path: Request path, as seen by the router (``request.url.path``).

    Returns:
        str | None: ``"read"``, ``"write"`` or ``"admin"``; ``None`` when the
        route is never reachable with an API key (platform administration).
    """
    if any(_matches_prefix(path, prefix) for prefix in API_KEY_FORBIDDEN_PREFIXES):
        return None
    if any(_matches_prefix(path, prefix) for prefix in ADMIN_SCOPE_PREFIXES):
        return SCOPE_ADMIN
    if method.upper() in SAFE_METHODS:
        return SCOPE_READ
    return SCOPE_WRITE


def api_key_scope_denial(method: str, path: str, raw_scopes: str | None) -> str | None:
    """
    Decide whether a secret API key with *raw_scopes* may call ``method path``.

    Returns:
        str | None: ``None`` when the request is allowed, otherwise the
        human-readable reason for the 403 (naming the missing scope).
    """
    required = required_api_key_scope(method, path)
    if required is None:
        return f"{method.upper()} {path} cannot be accessed with an API key."
    if required not in granted_scopes(raw_scopes):
        return f"This API key lacks the '{required}' scope required for {method.upper()} {path}."
    return None
