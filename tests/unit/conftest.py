"""
Unit-test conftest at the ``tests/unit/`` level.

Coordinates the lifecycle of MagicMock stubs needed by the
``tests/unit/services/`` subdirectory. The stubs replace heavy modules
(``app.core.pdf_engine``, ``app.models``, ``app.utils`` …) with
``unittest.mock.MagicMock`` so that lightweight service-level unit tests
can run without importing the full backend stack.

Why is the install/restore logic here and NOT in
``tests/unit/services/conftest.py``?
--------------------------------------------------------------------
pytest only invokes a conftest's hooks for collectors located AT or
BELOW the conftest's directory. That means a hook in
``tests/unit/services/conftest.py`` cannot observe (and therefore cannot
clean up after itself) when pytest moves on to siblings such as
``tests/unit/tasks/`` or ``tests/unit/test_coordinates.py``. If the
stubs were installed there and never torn down, they would poison
``sys.modules`` for the rest of the session — exactly the regression we
hit on 2026-04-26 (CI break "No module named 'app.utils.coordinates';
'app.utils' is not a package").

By centralising the install/restore in this parent conftest, we get
hooks that fire for every collector under ``tests/unit/``, allowing us
to toggle stubs in/out as we cross the services boundary.

WARNING — MagicMock stubs masquent certains bugs (post-mortem 04)
--------------------------------------------------------------------
Voir ``tests/unit/services/conftest.py`` pour la documentation détaillée
des limites de cette stratégie de mocking et les tests d'intégration qui
compensent ces angles morts.
"""

import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub registry
# ---------------------------------------------------------------------------

# Heavy third-party dependencies replaced with MagicMock so the lightweight
# unit tests can import app.services.font_extraction_service without paying
# the cost of the full backend stack.
_THIRD_PARTY_STUBS: tuple[str, ...] = (
    "pdfplumber",
    "pytesseract",
    "pdf2image",
    "celery",
    "sqlalchemy",
    "asyncpg",
    "alembic",
    "boto3",
    "stripe",
    "socketio",
)

# Internal app modules we replace with MagicMock to short-circuit the
# eager imports performed by app/services/__init__.py and friends.
_APP_MODULE_STUBS: tuple[str, ...] = (
    "app.core",
    "app.core.pdf_engine",
    "app.core.database",
    "app.core.cache",
    "app.middleware",
    "app.middleware.auth",
    "app.middleware.error_handler",
    "app.middleware.request_id",
    "app.models",
    "app.models.document",
    "app.models.history",
    "app.repositories",
    "app.repositories.document_repo",
    "app.utils",
    "app.utils.helpers",
)

_SERVICES_DIR = (Path(__file__).parent / "services").resolve()

# Sentinel marking modules that did not exist in sys.modules before stubbing.
_ABSENT = object()

_stubs_installed = False
_original_modules: dict[str, object] = {}


def _build_services_package_stub() -> types.ModuleType:
    """Return a synthetic ``app.services`` module backed by the real source dir.

    ``__path__`` points at the real folder so Python's finder still locates
    submodules like ``app.services.font_extraction_service`` on disk while we
    bypass the eager imports performed by the real ``app/services/__init__.py``.
    """
    real_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "app", "services")
    )
    stub = types.ModuleType("app.services")
    stub.__path__ = [real_path]  # type: ignore[attr-defined]
    stub.__package__ = "app.services"
    stub.DocumentService = MagicMock()  # type: ignore[attr-defined]
    stub.ElementService = MagicMock()  # type: ignore[attr-defined]
    stub.HistoryService = MagicMock()  # type: ignore[attr-defined]
    return stub


def _snapshot_and_replace(name: str, replacement: object) -> None:
    """Snapshot the prior value at *name* in sys.modules then install *replacement*."""
    _original_modules[name] = sys.modules[name] if name in sys.modules else _ABSENT
    sys.modules[name] = replacement  # type: ignore[assignment]


def _install_module_stubs() -> None:
    """Install MagicMock stubs in sys.modules, snapshotting prior state."""
    global _stubs_installed
    if _stubs_installed:
        return

    for name in _THIRD_PARTY_STUBS:
        if name not in sys.modules:
            _snapshot_and_replace(name, MagicMock())

    for name in _APP_MODULE_STUBS:
        _snapshot_and_replace(name, MagicMock())

    _snapshot_and_replace("app.services", _build_services_package_stub())

    _stubs_installed = True


def _restore_module_stubs() -> None:
    """Undo the sys.modules patching from :func:`_install_module_stubs`."""
    global _stubs_installed
    if not _stubs_installed:
        return
    for name, original in _original_modules.items():
        if original is _ABSENT:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original  # type: ignore[assignment]
    _original_modules.clear()
    _stubs_installed = False


def _is_services_path(path: object) -> bool:
    """Return True if *path* is inside ``tests/unit/services/``."""
    if path is None:
        return False
    try:
        candidate = Path(str(path)).resolve()
    except (OSError, ValueError):
        return False
    try:
        candidate.relative_to(_SERVICES_DIR)
    except ValueError:
        return False
    return True


def _collector_path(collector: object) -> object:
    """Extract the filesystem path from a pytest collector or item.

    Pytest exposes ``path`` (pathlib.Path) on modern versions and ``fspath``
    (py.path.local) on older ones. Accept either.
    """
    return getattr(collector, "path", None) or getattr(collector, "fspath", None)


# ---------------------------------------------------------------------------
# Pytest hooks
# ---------------------------------------------------------------------------


def pytest_collectstart(collector) -> None:  # type: ignore[no-untyped-def]
    """Toggle stubs based on whether *collector* targets the services subtree.

    Pytest visits collectors in tree order: ``Package(services)`` first, then
    its test modules, then sibling ``Module(test_coordinates.py)``. We must
    install stubs while inside ``services/`` and tear them down before pytest
    imports sibling modules — otherwise the stubs leak into ``app.utils`` /
    ``app.models`` for unrelated tests and break their collection.
    """
    if _is_services_path(_collector_path(collector)):
        _install_module_stubs()
    else:
        _restore_module_stubs()


def pytest_runtest_setup(item) -> None:  # type: ignore[no-untyped-def]
    """Ensure stubs match the test about to run.

    Collection-time toggling is necessary but not sufficient: tests are
    executed in a separate phase and a sibling test could run with stale
    stubs from collection. Re-toggle on every test setup.
    """
    if _is_services_path(_collector_path(item)):
        _install_module_stubs()
    else:
        _restore_module_stubs()


def pytest_sessionfinish(session, exitstatus) -> None:  # type: ignore[no-untyped-def]
    """Restore real modules on session end so other tooling sees a clean state."""
    _restore_module_stubs()
