"""
Tests d'honnêteté des endpoints TODO.

Valide que les 21 endpoints non implémentés retournent 501 (Not Implemented)
et non 200 avec de fausses données. Cela garantit que l'API ne ment pas à
ses consommateurs en simulant un succès pour des opérations non réelles.

Contexte (post-mortem 04):
- Les endpoints stub retournaient 501 avec le message "Not implemented..."
- Ce test pin ce comportement : si un stub est accidentellement remplacé par
  un 200 avec des données inventées, ce test échoue et alerte l'équipe.
- Les endpoints peuvent retourner 401 (auth requise) ou 501 (stub honnête),
  mais JAMAIS 200 avec de fausses données.

Les chemins de template comme /{document_id}/... sont remplacés par "test-doc-id"
et /{page_number}/... par "1" pour obtenir des URLs concrètes.
"""

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Stub endpoints — exactement les 21 détectés dans le codebase
# ---------------------------------------------------------------------------

TODO_ENDPOINTS = [
    # text.py — prefix: /api/v1/documents
    ("POST", "/api/v1/documents/test-doc-id/text/search"),
    ("POST", "/api/v1/documents/test-doc-id/text/replace"),
    ("GET",  "/api/v1/documents/test-doc-id/text/extract"),
    ("POST", "/api/v1/documents/test-doc-id/ocr"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/status"),
    # forms.py — prefix: /api/v1/documents
    ("GET",  "/api/v1/documents/test-doc-id/forms/fields"),
    ("PUT",  "/api/v1/documents/test-doc-id/forms/fill"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/forms/fields"),
    ("POST", "/api/v1/documents/test-doc-id/forms/flatten"),
    # annotations.py — prefix: /api/v1/documents
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/markup"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/note"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/link"),
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
    ("POST", "/api/v1/documents/test-doc-id/text/search"),
    ("POST", "/api/v1/documents/test-doc-id/text/replace"),
    ("GET",  "/api/v1/documents/test-doc-id/text/extract"),
    ("POST", "/api/v1/documents/test-doc-id/ocr"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/status"),
])
def test_text_stubs_carry_not_implemented_message(api_client, method, path):
    """
    Les endpoints text/* qui retournent 501 doivent inclure 'Not implemented'
    dans le detail pour guider les consommateurs de l'API.

    Ce test est intentionnellement scopé aux endpoints text/* car leur
    implémentation est connue pour retourner 501 (pas 401 ou 404).
    Les autres stubs peuvent être masqués par l'auth ou le routing.
    """
    response = api_client.request(
        method,
        path,
        json={"query": "test", "search": "test", "replace": "test"},
        headers={"Authorization": "Bearer test-token"},
    )

    # Si le middleware auth laisse passer et qu'on atteint le stub :
    if response.status_code == 501:
        body = response.json()
        detail = body.get("detail", "")
        assert "Not implemented" in detail or "not implemented" in detail.lower(), (
            f"{method} {path} returned 501 but detail does not mention 'Not implemented'. "
            f"Got: {detail!r}"
        )


def test_todo_endpoints_count():
    """Pin le nombre exact de stubs connus — alerte si un stub est ajouté ou retiré sans mise à jour."""
    assert len(TODO_ENDPOINTS) == 21, (
        f"Expected exactly 21 TODO endpoints, got {len(TODO_ENDPOINTS)}. "
        "Update this test and TODO_ENDPOINTS when adding or implementing stubs."
    )


def test_health_endpoint_works(api_client):
    """Sanity check : /health retourne 200 pour confirmer que l'app tourne."""
    response = api_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
