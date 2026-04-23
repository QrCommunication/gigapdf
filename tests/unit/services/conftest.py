"""
Unit-level conftest for services tests.

Isolates the service under test from the full application dependency tree.
The app.services package eagerly imports DocumentService/ElementService which
require pdfplumber, PyMuPDF, Celery, etc. — none of which are available in
the lightweight unit-test environment.

We stub out the package-level __init__ imports so that importing
app.services.font_extraction_service works without the full stack.

WARNING — MagicMock stubs masquent certains bugs (post-mortem 04)
--------------------------------------------------------------------
Ce conftest installe des MagicMock pour app.core.pdf_engine et plusieurs
dépendances lourdes. Cela a deux effets secondaires importants à connaître :

1. MagicMock implémente __getitem__ par défaut : tout accès pdf_doc[i]
   réussit silencieusement et retourne un autre MagicMock au lieu de lever
   TypeError. Le bug LegacyDocumentProxy subscript (pdfDoc[i]) aurait été
   INVISIBLE ici — les tests unitaires auraient été verts.

2. Les appels au vrai PDFEngine (pikepdf) ne sont jamais exercés depuis
   cette couche : les bugs d'AttributeError/TypeError liés à l'API pikepdf
   ne peuvent pas être détectés ici.

Pour attraper ces régressions, utiliser les tests d'intégration :
  tests/integration/test_storage_integration.py
    → Exercent le vrai PDFEngine + la vraie LegacyDocumentProxy
    → Capturent les erreurs que les mocks rendent invisibles
    → N'utilisent PAS MagicMock pour pdf_engine

Règle : chaque nouveau comportement de pdf_engine DOIT avoir un test dans
tests/integration/test_storage_integration.py, pas seulement ici.
"""

import sys
import types
from unittest.mock import MagicMock


def _install_stub(name: str) -> MagicMock:
    """Register a MagicMock module at *name* and all its parents."""
    parts = name.split(".")
    for i in range(1, len(parts) + 1):
        qualified = ".".join(parts[:i])
        if qualified not in sys.modules:
            sys.modules[qualified] = MagicMock()
    return sys.modules[name]


# Stub heavy dependencies before any app module is imported
_STUBS = [
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
]

for _dep in _STUBS:
    if _dep not in sys.modules:
        _install_stub(_dep)

# Prevent the app.services __init__.py from re-running its eager imports
# by injecting lightweight stubs for the services it tries to import.
for _svc in ("DocumentService", "ElementService", "HistoryService"):
    # Ensure app.services exists as a real module (it will be replaced below)
    pass

# Replace app.services with a proper package stub.
# __path__ must point to the real directory so Python's finder can still
# locate submodules like app.services.font_extraction_service on disk.
import os as _os
_services_real_path = _os.path.join(
    _os.path.dirname(__file__), "..", "..", "..", "app", "services"
)
_services_stub = types.ModuleType("app.services")
_services_stub.__path__ = [_os.path.abspath(_services_real_path)]
_services_stub.__package__ = "app.services"
_services_stub.DocumentService = MagicMock()  # type: ignore[attr-defined]
_services_stub.ElementService = MagicMock()   # type: ignore[attr-defined]
_services_stub.HistoryService = MagicMock()   # type: ignore[attr-defined]
sys.modules.setdefault("app.services", _services_stub)

# Also stub app.core and its submodules to prevent cascade failures
for _core_mod in (
    "app.core",
    "app.core.pdf_engine",
    "app.core.database",
    "app.core.cache",
):
    sys.modules.setdefault(_core_mod, MagicMock())

# Stub app.middleware so auth imports don't cascade into jose
for _mw in (
    "app.middleware",
    "app.middleware.auth",
    "app.middleware.error_handler",
    "app.middleware.request_id",
):
    sys.modules.setdefault(_mw, MagicMock())

# Stub app.models (used transitively)
for _model in (
    "app.models",
    "app.models.document",
    "app.models.history",
):
    sys.modules.setdefault(_model, MagicMock())

# Stub app.repositories
for _repo in (
    "app.repositories",
    "app.repositories.document_repo",
):
    sys.modules.setdefault(_repo, MagicMock())

# Stub app.utils
for _util in (
    "app.utils",
    "app.utils.helpers",
):
    sys.modules.setdefault(_util, MagicMock())
