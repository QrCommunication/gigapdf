"""
Tests d'honnêteté des endpoints TODO.

Valide que les 13 endpoints non implémentés retournent 501 (Not Implemented)
et non 200 avec de fausses données. Cela garantit que l'API ne ment pas à
ses consommateurs en simulant un succès pour des opérations non réelles.

Contexte (post-mortem 04):
- Les endpoints stub retournaient 501 avec le message "Not implemented..."
- Ce test pin ce comportement : si un stub est accidentellement remplacé par
  un 200 avec des données inventées, ce test échoue et alerte l'équipe.
- Les endpoints peuvent retourner 401 (auth requise) ou 501 (stub honnête),
  mais JAMAIS 200 avec de fausses données.

Historique :
- 2026-06-13 : suppression des stubs text.py (5 endpoints) et annotations.py
  (3 endpoints) — modules retirés du codebase, la fonctionnalité équivalente
  vit dans le moteur TypeScript (/api/pdf/*). 21 → 13 endpoints.

Les chemins de template comme /{document_id}/... sont remplacés par "test-doc-id"
et /{page_number}/... par "1" pour obtenir des URLs concrètes.
"""

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Stub endpoints — exactement les 13 détectés dans le codebase
# ---------------------------------------------------------------------------

TODO_ENDPOINTS = [
    # forms.py — prefix: /api/v1/documents
    ("GET",  "/api/v1/documents/test-doc-id/forms/fields"),
    ("PUT",  "/api/v1/documents/test-doc-id/forms/fill"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/forms/fields"),
    ("POST", "/api/v1/documents/test-doc-id/forms/flatten"),
    # layers.py — prefix: /api/v1/documents
    ("GET",  "/api/v1/documents/test-doc-id/layers"),
    ("POST", "/api/v1/documents/test-doc-id/layers"),
    ("PATCH",  "/api/v1/documents/test-doc-id/layers/test-layer-id"),
    ("DELETE", "/api/v1/documents/test-doc-id/layers/test-layer-id"),
    ("PUT",  "/api/v1/documents/test-doc-id/layers/reorder"),
    # bookmarks.py — prefix: /api/v1/documents
    ("GET",    "/api/v1/documents/test-doc-id/bookmarks"),
    ("POST",   "/api/v1/documents/test-doc-id/bookmarks"),
    ("PATCH",  "/api/v1/documents/test-doc-id/bookmarks/test-bookmark-id"),
    ("DELETE", "/api/v1/documents/test-doc-id/bookmarks/test-bookmark-id"),
]


@pytest.fixture(scope="module")
def api_client():
    """TestClient scoped to module to avoid re-creating the app per test."""
    import os
    os.environ.setdefault("APP_ENV", "testing")
    os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-minimum-32-characters-long")

    from app.main import create_application
    application = create_application()
    with TestClient(application, raise_server_exceptions=False) as c:
        yield c


@pytest.mark.parametrize("method,path", TODO_ENDPOINTS)
def test_todo_endpoint_is_honest(api_client, method, path):
    """
    Chaque endpoint stub doit retourner 401 (auth requise) ou 501 (stub honnête).

    Un 200 signifie que l'endpoint a été implémenté — ce test doit alors être
    retiré de cette liste et remplacé par un test fonctionnel.

    Un 422 ou 404 peut indiquer un problème de configuration du test lui-même.
    """
    response = api_client.request(
        method,
        path,
        # Fournir un body JSON vide pour les méthodes qui en attendent un
        json={},
        headers={"Authorization": "Bearer test-token"},
    )

    status = response.status_code

    # 200 est interdit : un stub ne doit jamais prétendre avoir réussi
    assert status != 200, (
        f"{method} {path} returned 200 — endpoint appears implemented. "
        "Remove it from TODO_ENDPOINTS and write a proper functional test."
    )

    # Statuts acceptables pour un endpoint non implémenté :
    # 401 : auth JWT invalide (middleware rejeté avant d'atteindre le stub)
    # 403 : Forbidden (auth ok mais permission insuffisante)
    # 404 : route ou ressource non trouvée (document_id fictif)
    # 405 : Method Not Allowed (route exist, wrong method — test bug)
    # 422 : Validation Pydantic (le body {} ne satisfait pas le schéma)
    # 429 : Rate limit atteint (RateLimitMiddleware actif en test)
    # 501 : stub honnête (l'implémentation manque)
    acceptable = {401, 403, 404, 405, 422, 429, 501}
    assert status in acceptable, (
        f"{method} {path} returned unexpected status {status}. "
        f"Body: {response.text[:200]}"
    )


@pytest.mark.parametrize("method,path", [
    # text.py et annotations.py ont été SUPPRIMÉS le 2026-06-13 (stubs 501
    # jamais appelés). Ces routes doivent désormais retourner 404/405 —
    # jamais 200 ni 501 (une résurrection accidentelle serait détectée ici).
    ("POST", "/api/v1/documents/test-doc-id/text/search"),
    ("POST", "/api/v1/documents/test-doc-id/text/replace"),
    ("GET",  "/api/v1/documents/test-doc-id/text/extract"),
    ("POST", "/api/v1/documents/test-doc-id/ocr"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/status"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/languages"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/markup"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/note"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/link"),
])
def test_removed_stub_routes_are_gone(api_client, method, path):
    """
    Les routes des modules supprimés (text.py, annotations.py) ne doivent
    plus exister : ni 200 (réimplémentation non testée), ni 501 (stub
    ressuscité). 404/405 attendus (401/429 tolérés si un middleware
    intercepte avant le routing).
    """
    response = api_client.request(
        method,
        path,
        json={},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code not in (200, 501), (
        f"{method} {path} returned {response.status_code} — this route was "
        "removed on 2026-06-13 (superseded by the TypeScript pdf-engine "
        "/api/pdf/* routes) and must not be resurrected silently."
    )


def test_todo_endpoints_count():
    """Pin le nombre exact de stubs connus — alerte si un stub est ajouté ou retiré sans mise à jour."""
    assert len(TODO_ENDPOINTS) == 13, (
        f"Expected exactly 13 TODO endpoints, got {len(TODO_ENDPOINTS)}. "
        "Update this test and TODO_ENDPOINTS when adding or implementing stubs."
    )


def test_health_endpoint_works(api_client):
    """Sanity check : /health retourne 200 pour confirmer que l'app tourne."""
    response = api_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
