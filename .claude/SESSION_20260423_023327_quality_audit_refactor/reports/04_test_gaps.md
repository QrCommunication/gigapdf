# 04 — Test Coverage Gaps

## Résumé

| Domaine | Fichiers source | Avec tests | Sans tests | % couvert |
|---------|-----------------|-----------|-----------|-----------|
| packages/pdf-engine | 46 | 24 | 22 | 52 % |
| packages/editor | 25 | 1 | 24 | 4 % |
| packages/api | 32 | 0 | 32 | 0 % |
| apps/web/src/app/api/pdf | 18 routes | 0 | 18 | 0 % |
| apps/web/src/hooks | 1 hook testé (use-document-save) | 1 | ~10 | ~10 % |
| app/services (Python) | 18 | 1 | 17 | 6 % |
| app/api/v1 (Python, hors admin) | 25 | 1 | 24 | 4 % |
| app/core (Python) | 5 | 0 | 5 | 0 % |

**Total Python** : 48 fichiers source → 2 avec tests → couverture ~4 %
**Total TypeScript** : ~121 fichiers source → ~25 avec tests → couverture ~21 %

---

## Fichiers critiques sans test (top 20)

1. `app/services/document_service.py` — Orchestre upload, session, page extraction. C'est ici qu'a eu lieu le bug `LegacyDocumentProxy object is not subscriptable`. Aucun test unitaire ni intégration.

2. `app/api/v1/storage.py` — 13 routes (save, load, versions, folders). Le chemin `POST /storage/documents/{id}/load` appelle `document_service.upload_document()` avec des bytes S3 réels. Aucun test.

3. `app/repositories/document_repo.py` — Gestion hybride in-memory + Redis des sessions, désérialisation de `LegacyDocumentProxy`. Deux bugs récentement fixés ici (commit `cb464c4`, `c05f160`). Aucun test.

4. `app/core/pdf_engine.py` — `PDFEngine`, `LegacyDocumentProxy`, `LegacyPageProxy`. La compatibilité de l'interface (subscript vs `.get_page()`) n'est pas testée. Aucun test.

5. `app/services/quota_service.py` — Vérifie les quotas avant chaque upload. Si elle lève silencieusement ou retourne un mauvais booléen, les uploads passent quand ils ne devraient pas.

6. `app/services/s3_service.py` — Upload/download S3. Appelé dans chaque route de `storage.py`. Aucun test, même avec mock.

7. `app/services/element_service.py` — Manipulation des éléments (texte, images, annotations) dans la session. Logique métier centrale.

8. `packages/editor/src/stores/document-store.ts` — Store Zustand principal de l'éditeur. Aucun test des reducers ni des selectors.

9. `packages/editor/src/middleware/persistence-middleware.ts` — Persiste l'état de l'éditeur vers l'API. Aucun test.

10. `packages/editor/src/middleware/sync-middleware.ts` — Sync collaborative. Aucun test.

11. `packages/editor/src/actions/element-actions.ts` — Actions CRUD sur les éléments. Aucun test.

12. `apps/web/src/app/api/pdf/save/route.ts` — Route critique : reçoit le PDF depuis l'éditeur et le sauvegarde. Aucun test de route.

13. `apps/web/src/app/api/pdf/apply-elements/route.ts` — Applique les éléments (texte, images, formes) sur le PDF. Aucun test de route.

14. `apps/web/src/app/api/pdf/parse/route.ts` — Parse le PDF via la bibliothèque TS. Aucun test de route.

15. `packages/pdf-engine/src/render/redaction.ts` — Rédaction irréversible. Si un bug passe inaperçu, des données sensibles peuvent ne pas être expurgées.

16. `packages/pdf-engine/src/render/form-renderer.ts` — Rendu des champs de formulaire. Aucun test.

17. `packages/pdf-engine/src/preview/renderer.ts` — Rendu des miniatures. Aucun test.

18. `app/api/v1/documents.py` — 5 routes (upload, get, delete, etc.). Aucun test TestClient.

19. `app/api/v1/pages.py` — 9 routes (get, add, delete, reorder, rotate). Aucun test.

20. `app/services/history_service.py` — Gestion undo/redo. Aucun test. Si corrompu, les utilisateurs perdent leurs modifications.

---

## Endpoints FastAPI sans TestClient test

Les seuls endpoints avec tests intégration sont :
- `GET /health` (test_api_health.py)
- `POST/GET/PATCH/DELETE /api/v1/api-keys` (test_api_keys.py — 14 tests)
- `GET /api/v1/pdf/fonts/{document_id}` (test_fonts_endpoints.py)
- `GET /api/v1/pdf/fonts/{document_id}/{font_id}` (test_fonts_endpoints.py)

### Endpoints sans aucun test (liste prioritaire)

| Priorité | Endpoint | Raison |
|----------|----------|--------|
| P0 | `POST /api/v1/storage/documents` | Save principal depuis l'éditeur |
| P0 | `POST /api/v1/storage/documents/{id}/load` | A déclenché le bug en prod |
| P0 | `POST /api/v1/documents` (upload) | Upload initial de tout document |
| P0 | `GET /api/v1/documents/{id}` | Fetch de la structure du document |
| P1 | `POST /api/v1/storage/documents/{id}/versions` | Versioning |
| P1 | `GET /api/v1/storage/documents` | Listing documents |
| P1 | `GET/POST /api/v1/pages` | Manipulation de pages |
| P1 | `GET/POST /api/v1/elements` | Éléments PDF |
| P1 | `POST /api/v1/history/*` | Undo/redo |
| P2 | Tous les endpoints `/api/v1/billing/*` (14 routes) | Critique pour le business |
| P2 | `POST /api/v1/export` | Export PDF final |
| P2 | `GET/POST /api/v1/forms` | Formulaires PDF |
| P2 | `POST /api/v1/sharing/*` | Partage documents |

Total : **186 routes FastAPI** (136 hors admin + 50 admin) → **4 avec tests** → couverture 2 %.

---

## Tests suspects (MagicMock-heavy)

1. **`tests/integration/test_api_keys.py`** — 22 occurrences de `MagicMock`.
   - Problème : la session SQLAlchemy (`get_db`) est entièrement mockée. Le test vérifie que le controller appelle `session.execute` et retourne la bonne structure JSON, mais ne valide pas que la requête SQL construite est correcte ni que les contraintes DB sont respectées.
   - Valide-t-il un comportement ou une implémentation ? Comportement partiel — les status HTTP et les champs de réponse sont correctement vérifiés. Mais le vrai test d'intégration (avec une vraie DB PostgreSQL de test) est absent. Si la requête Alchemy change de forme sans changer le résultat mocké, le test reste vert.

2. **`tests/unit/services/conftest.py`** — 12 occurrences de `MagicMock` (stubs de modules).
   - Ce fichier stub-ise toute la stack (`pdfplumber`, `sqlalchemy`, `boto3`, `app.core.pdf_engine`, etc.) pour isoler `FontExtractionService`. C'est justifié pour les tests unitaires de logique pure.
   - Risque : si un module stubbé change d'interface publique (ex: `app.repositories.document_repo`), le test unitaire ne le verra pas.

3. **`tests/integration/api/test_fonts_endpoints.py`** — 6 occurrences de `MagicMock`.
   - `get_document_session` est mocké avec un `DocumentSession` synthétique contenant un vrai PDF pikepdf minimal. Correct comme stratégie.
   - Le mock de Redis (`aioredis`) est justifié — évite une dépendance externe en CI.

4. **`tests/integration/test_websocket_collaboration.py`** — 5 occurrences de `MagicMock`.
   - Non examiné en détail, mais la collaboration WebSocket est complexe et bénéficierait d'un test E2E avec deux clients connectés simultanément.

---

## Post-mortem bug LegacyDocumentProxy

### Ce qui s'est passé

Lors du refactor de `PyMuPDF` → `pikepdf` + `LegacyDocumentProxy`, la méthode `upload_document()` dans `document_service.py` construisait la liste des pages via une list comprehension qui utilisait l'accès par index `pdf_doc[i]` — hérité de la syntaxe `fitz.Document` (PyMuPDF) :

```python
# Code avant le fix (commit c05f160)
pages = [
    PageObject(
        page_id=generate_uuid(),
        page_number=i + 1,
        dimensions=Dimensions(
            width=pdf_doc[i].rect.width,     # <-- BUG : pdf_doc[i]
            height=pdf_doc[i].rect.height,
            rotation=int(pdf_doc[i].rotation or 0),
        ),
        ...
    )
    for i in range(pdf_doc.page_count)
]
```

`LegacyDocumentProxy` est une classe Python simple qui ne définit pas `__getitem__`. L'accès `pdf_doc[i]` lève donc `TypeError: 'LegacyDocumentProxy' object is not subscriptable` à chaque appel à `upload_document()` — c'est-à-dire à chaque upload de document ET à chaque `POST /storage/documents/{id}/load`.

### Pourquoi les tests existants n'ont pas attrapé le bug

**Il n'existait aucun test pour `document_service.py`.** Le seul fichier de test unitaire de services qui existe est `test_font_extraction_service.py`, qui ne touche pas `DocumentService`.

Le `conftest.py` de `tests/unit/services/` stub-ise `app.core.pdf_engine` entier via `MagicMock()`. Ainsi, si un test hypothétique avait importé `DocumentService` et appelé `upload_document()` avec un mock de `pdf_engine.open_document()`, le `pdf_doc` retourné aurait été un `MagicMock` — et `MagicMock` supporte `__getitem__` par défaut (il retourne un autre `MagicMock`). Le test aurait donc été vert même avec le code buggué.

C'est le mécanisme exact du "test théâtre" : le mock de `MagicMock` accepte silencieusement `pdf_doc[i]` et retourne `MagicMock().rect.width` = un autre `MagicMock`, qui est accepté comme `float` par Pydantic si la validation de type est laxiste. Le bug n'aurait été visible qu'avec un vrai `LegacyDocumentProxy`.

### Test à ajouter (code proposé)

```python
# tests/integration/api/test_storage_load.py
"""
Tests d'intégration pour les routes critiques de storage.

Stratégie :
- Utiliser un vrai PDF minimal (pikepdf) sans mock du pdf_engine.
- Mocker uniquement les dépendances externes : S3, Redis, SQLAlchemy.
- Valider le comportement de bout en bout : upload → session créée → load → session restaurée.
"""
from __future__ import annotations

import io
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pikepdf
import pytest
from fastapi.testclient import TestClient

from app.middleware.auth import CurrentUser, get_current_user


def _build_minimal_pdf(page_count: int = 2) -> bytes:
    """Construit un vrai PDF pikepdf avec N pages."""
    pdf = pikepdf.Pdf.new()
    for _ in range(page_count):
        page = pikepdf.Dictionary(
            Type=pikepdf.Name("/Page"),
            MediaBox=[0, 0, 612, 792],
        )
        pdf.pages.append(page)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


FAKE_PDF_2_PAGES = _build_minimal_pdf(page_count=2)
FAKE_USER = CurrentUser(user_id="test-user-storage-001", email="test@example.com")

FAKE_STORED_DOC_ID = "doc-stored-00000000-0000-0000-0000-000000000001"
FAKE_S3_KEY = f"pdf/{FAKE_STORED_DOC_ID}/v1.pdf"


@pytest.fixture(scope="module")
def app():
    from app.main import create_application
    application = create_application()

    async def _fake_user() -> CurrentUser:
        return FAKE_USER

    application.dependency_overrides[get_current_user] = _fake_user
    yield application
    application.dependency_overrides.clear()


@pytest.fixture(scope="module")
def client(app) -> TestClient:
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


class TestStorageLoadDocument:
    """POST /api/v1/storage/documents/{stored_document_id}/load"""

    def test_load_stored_document_creates_session_with_real_pdf(self, client):
        """
        Vérifie qu'un vrai PDF pikepdf peut être chargé depuis S3 simulé et
        qu'une session est créée avec le bon page_count.

        Ce test attrape le bug LegacyDocumentProxy (subscript error) : si
        document_service.upload_document() utilise pdf_doc[i] au lieu de
        engine.get_page(doc_id, i+1), ce test lève TypeError en production.
        """
        fake_db_doc = MagicMock()
        fake_db_doc.id = FAKE_STORED_DOC_ID
        fake_db_doc.s3_key = FAKE_S3_KEY
        fake_db_doc.name = "Test Document"
        fake_db_doc.owner_id = FAKE_USER.user_id
        fake_db_doc.current_version = 1

        fake_scalar = MagicMock()
        fake_scalar.scalar_one_or_none.return_value = fake_db_doc

        async def _fake_get_db() -> AsyncGenerator:
            session = AsyncMock()
            session.execute = AsyncMock(return_value=fake_scalar)
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            yield session

        with patch("app.services.s3_service.s3_service.download_file", return_value=FAKE_PDF_2_PAGES), \
             patch("app.services.document_service.document_sessions.create_session", new_callable=AsyncMock) as mock_create_session, \
             patch("app.core.database.get_db", _fake_get_db), \
             patch("app.core.database.get_db_session", _fake_get_db):

            # Simuler la réponse de create_session
            mock_create_session.return_value = MagicMock(document_id="new-session-id-001")

            response = client.post(
                f"/api/v1/storage/documents/{FAKE_STORED_DOC_ID}/load",
                headers={"Authorization": "Bearer fake-token"},
            )

        # Sans le fix, on obtiendrait une 500 avec :
        # TypeError: 'LegacyDocumentProxy' object is not subscriptable
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

        body = response.json()
        assert body["success"] is True
        assert "document_id" in body["data"]

    def test_load_nonexistent_stored_document_returns_404(self, client):
        """Un stored_document_id inexistant doit retourner 404."""
        fake_scalar = MagicMock()
        fake_scalar.scalar_one_or_none.return_value = None

        async def _fake_get_db() -> AsyncGenerator:
            session = AsyncMock()
            session.execute = AsyncMock(return_value=fake_scalar)
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            yield session

        with patch("app.core.database.get_db", _fake_get_db), \
             patch("app.core.database.get_db_session", _fake_get_db):

            response = client.post(
                "/api/v1/storage/documents/00000000-dead-dead-dead-000000000000/load",
                headers={"Authorization": "Bearer fake-token"},
            )

        assert response.status_code == 404


class TestDocumentServiceUploadWithRealPDF:
    """
    Tests unitaires de DocumentService.upload_document() avec un vrai
    LegacyDocumentProxy — pas de MagicMock sur pdf_engine.
    """

    def test_upload_document_parses_page_dimensions_without_subscript(self):
        """
        upload_document() doit itérer les pages via engine.get_page(),
        pas via pdf_doc[i]. Ce test reproduit exactement le bug en prod.
        """
        import asyncio
        from app.services.document_service import DocumentService
        from app.core.pdf_engine import PDFEngine

        engine = PDFEngine()
        service = DocumentService()
        service.engine = engine  # utiliser un vrai engine, pas un mock

        async def run():
            doc_id, scene_graph = await service.upload_document(
                file_data=FAKE_PDF_2_PAGES,
                filename="test.pdf",
                owner_id="user-001",
            )
            return doc_id, scene_graph

        # Sans le fix : TypeError: 'LegacyDocumentProxy' object is not subscriptable
        with patch("app.services.document_service.document_sessions") as mock_sessions:
            mock_sessions.create_session = AsyncMock()
            doc_id, scene_graph = asyncio.run(run())

        assert scene_graph.metadata.page_count == 2
        assert len(scene_graph.pages) == 2
        assert scene_graph.pages[0].dimensions.width == 612.0
        assert scene_graph.pages[0].dimensions.height == 792.0
        assert scene_graph.pages[1].page_number == 2

        # Cleanup
        engine.close_document(doc_id)

    def test_upload_rejects_file_too_large(self):
        """upload_document() doit lever InvalidOperationError si file > max_size."""
        import asyncio
        from app.services.document_service import DocumentService
        from app.middleware.error_handler import InvalidOperationError
        from app.core.pdf_engine import PDFEngine

        engine = PDFEngine()
        service = DocumentService()
        service.engine = engine
        service.settings.max_upload_size_bytes = 10  # 10 bytes max pour le test

        async def run():
            return await service.upload_document(
                file_data=FAKE_PDF_2_PAGES,  # > 10 bytes
                filename="big.pdf",
            )

        with pytest.raises(InvalidOperationError, match="File too large"):
            asyncio.run(run())
```

---

## Recommandations priorisées

### P0 — Tests d'intégration FastAPI pour le chemin de bug production

Créer `tests/integration/api/test_storage_load.py` (code ci-dessus).

Ce test couvre exactement le scénario du bug : `POST /storage/documents/{id}/load` appelle `document_service.upload_document()` avec un vrai `LegacyDocumentProxy`. Sans mock sur `pdf_engine`, tout `pdf_doc[i]` lève immédiatement, rendant le bug impossible à manquer.

Créer aussi `tests/integration/api/test_documents.py` pour `POST /api/v1/documents` (upload initial).

### P0 — Test unitaire de DocumentService avec vrai PDF

La classe `DocumentServiceUploadWithRealPDF` dans le code ci-dessus. Contrainte : ne pas stubbiser `app.core.pdf_engine` — utiliser un vrai `PDFEngine()` instancié localement.

### P1 — Round-trip tests pour les 6 routes web `/api/pdf/*` critiques

Les routes suivantes n'ont aucun test de round-trip :

| Route web | Ce qu'elle fait | Test manquant |
|-----------|-----------------|---------------|
| `POST /api/pdf/save` | Reçoit PDF bytes → sauvegarde | round-trip : envoyer un vrai PDF, vérifier que les bytes retournés sont un PDF valide |
| `POST /api/pdf/apply-elements` | Applique des éléments sur le PDF | round-trip : texte ajouté → re-parser → texte présent |
| `POST /api/pdf/parse` | Parse un PDF → scene graph JSON | round-trip : page_count correspond |
| `POST /api/pdf/merge` | Merge N PDFs | round-trip : page_count = somme des inputs |
| `POST /api/pdf/split` | Split un PDF | round-trip : N PDFs résultants valides |
| `POST /api/pdf/encrypt` | Chiffre un PDF | round-trip : `pikepdf.open()` lève `PasswordError` sans mot de passe |

Ces routes sont dans `apps/web/src/app/api/pdf/` (Next.js App Router). Les tests peuvent être écrits en Vitest avec `fetch` mock ou en utilisant le Next.js test adapter.

### P1 — Remplacer les stubs globaux dans conftest.py par des fixtures ciblées

Le `conftest.py` de `tests/unit/services/` stubbise `app.core.pdf_engine` avec `MagicMock()`. Toute classe testée qui importe `pdf_engine` recevra un mock acceptant n'importe quelle opération, y compris `pdf_doc[i]`.

Règle : si un service utilise `pdf_engine` ou `LegacyDocumentProxy`, le test DOIT soit :
1. Instancier un vrai `PDFEngine()` avec un PDF pikepdf minimal, OU
2. Utiliser un `LegacyDocumentProxy` réel (`LegacyDocumentProxy(doc_id, bytes, page_count, False)`)

Ne jamais laisser `MagicMock()` se substituer à un objet qui a une interface précise (`__getitem__` absent = erreur en prod).

### P2 — Couverture des stores et actions de packages/editor

`packages/editor` a 25 fichiers source et 0 test (sauf `use-embedded-fonts.test.tsx` dans le répertoire hooks). Les stores Zustand (`document-store.ts`, `history-store.ts`) et les actions CRUD (`element-actions.ts`, `page-actions.ts`) sont des candidats prioritaires pour des tests Vitest avec `@testing-library/react` + `renderHook`.

### P2 — Tests de l'API Python pour les domaines sans couverture

Ordre de priorité des domaines Python à couvrir en premier :

1. `document_service.py` + `storage.py` (bug récent, chemin critique)
2. `document_repo.py` (désérialisation Redis + LegacyDocumentProxy)
3. `quota_service.py` (garde-fou avant tout upload)
4. `element_service.py` (logique métier principale de l'éditeur)
5. `history_service.py` (undo/redo — perte de données si corrompu)
