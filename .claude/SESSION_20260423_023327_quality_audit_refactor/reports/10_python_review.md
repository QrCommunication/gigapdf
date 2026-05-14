# 10 — Python Code Review

> Review ciblé post-Phase 1. Aucun fichier source modifié.
> Date : 2026-04-22. Zones : app/services/, app/api/v1/, app/core/, app/tasks/, app/repositories/
> Phase 1 lue avant review pour éviter les doublons.

---

## Top 20 "fix cards" priorisés

---

### P0-001 — Bug actif : extract_image inexistant sur LegacyDocumentProxy
**Fichier** : `app/services/document_service.py:281`
**Problème** : `session.pdf_doc.extract_image(image_xref)` — `LegacyDocumentProxy` n'expose pas cette méthode. Confirmé : aucune méthode `extract_image` dans `app/core/pdf_engine.py` (class `LegacyDocumentProxy` lines 425–506).
**Impact** : `AttributeError` à chaque appel à `GET /documents/{id}/pages/{n}/images/{xref}`. Runtime error en production.
**Fix** : La route n'est appelée par aucun composant frontend (confirmé Phase 1 rapport 03). Supprimer le handler HTTP et la méthode `get_page_image()`.
```python
# app/api/v1/pages.py : supprimer le @router.get("/{page_number}/images/{image_xref}")
# app/services/document_service.py : supprimer get_page_image() lines 258-307
```
Si la feature est voulue dans le futur : implémenter via `pikepdf` dans un context manager dédié (lire `pdf.pages[n].Resources.XObject`).
**Test** : S'assurer que la route ne répond plus 500 (test négatif — la route doit retourner 404 Not Found si supprimée, ou n'exister plus du tout).
**Priorité** : P0

---

### P0-002 — Silent no-op : reorder_pages() ne réordonne pas le PDF
**Fichier** : `app/services/document_service.py:543`, `app/core/pdf_engine.py:497-506`
**Problème** : `document_service.reorder_pages()` appelle `session.pdf_doc.select(new_order)` qui est une méthode no-op documentée sur `LegacyDocumentProxy` (log warning uniquement, aucune modification du PDF). Le scene graph est réordonné en mémoire, mais le PDF binaire stocké en Redis reste inchangé. Quand l'utilisateur télécharge le document, les pages sont dans l'ordre original.
**Impact** : La feature "réordonner les pages" retourne `success: true` et présente le bon ordre dans l'UI, mais le PDF exporté a les pages dans l'ordre incorrect. Data integrity issue silencieux.
**Fix** :
```python
# document_service.reorder_pages() — remplacer le no-op par pikepdf réel
import io
import pikepdf

def reorder_pages(self, document_id: str, new_order: list[int]) -> list[PageObject]:
    session = document_sessions.get_session_sync(document_id)
    if not session:
        raise DocumentNotFoundError(document_id)

    page_count = session.scene_graph.metadata.page_count
    if sorted(new_order) != list(range(1, page_count + 1)):
        raise InvalidOperationError(f"Invalid page order. Expected pages 1-{page_count}")

    # Réordonner le PDF binaire via pikepdf
    pdf_bytes = session.pdf_doc.tobytes()
    output = io.BytesIO()
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        original_pages = list(pdf.pages)
        pdf.pages.clear()
        for page_num in new_order:
            pdf.pages.append(original_pages[page_num - 1])
        pdf.save(output)

    new_bytes = output.getvalue()
    # Mettre à jour le proxy et les bytes stockés
    from app.core.pdf_engine import LegacyDocumentProxy, pdf_engine
    pdf_engine._documents[document_id] = new_bytes
    session.pdf_doc = LegacyDocumentProxy(document_id, new_bytes, page_count, session.pdf_doc.is_encrypted)
    session._pdf_bytes = new_bytes

    # Scene graph update (inchangé)
    new_pages = [session.scene_graph.pages[p - 1] for p in new_order]
    for i, page in enumerate(new_pages):
        page.page_number = i + 1
    session.scene_graph.pages = new_pages
    ...
```
**Test** : Upload PDF 3 pages → reorder [3,1,2] → download → vérifier pikepdf que page 1 du résultat = ancienne page 3.
**Priorité** : P0

---

### P0-003 — Silent no-op : add_page / delete_page / rotate_page ne modifient pas le PDF
**Fichier** : `app/services/document_service.py:402, 452, 499`, `app/core/pdf_engine.py:231-280`
**Problème** : `self.engine.add_page()`, `delete_page()`, `rotate_page()` sont tous des no-ops qui logguent un warning et retournent sans modifier le PDF binaire. La scène graph est mise à jour en mémoire mais le PDF exporté est inchangé. Même pattern que P0-002.
**Impact** : Toutes les opérations de manipulation de pages (ajout, suppression, rotation) retournent `success: true` mais le PDF téléchargé ne reflète pas les changements. Data integrity silencieux, sévère pour une app PDF editor.
**Fix** : Implémenter via pikepdf dans `PDFEngine` (similaire à P0-002) :
```python
# PDFEngine.add_page() — ajouter une vraie page vierge
def add_page(self, document_id, position, width=612, height=792):
    pdf_bytes = self._documents[document_id]
    output = io.BytesIO()
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        new_page = pikepdf.Dictionary(
            Type=pikepdf.Name("/Page"),
            MediaBox=[0, 0, width, height],
        )
        pdf.pages.insert(position - 1, new_page)
        pdf.save(output)
    self._documents[document_id] = output.getvalue()
    return LegacyPageProxy(position, width, height)

# PDFEngine.delete_page()
def delete_page(self, document_id, page_number):
    pdf_bytes = self._documents[document_id]
    output = io.BytesIO()
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        del pdf.pages[page_number - 1]
        pdf.save(output)
    self._documents[document_id] = output.getvalue()

# PDFEngine.rotate_page()
def rotate_page(self, document_id, page_number, angle):
    pdf_bytes = self._documents[document_id]
    output = io.BytesIO()
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[page_number - 1]
        current = int(page.get("/Rotate", 0))
        page["/Rotate"] = (current + angle) % 360
        pdf.save(output)
    self._documents[document_id] = output.getvalue()
```
**Test** : Upload PDF 3 pages → add_page(position=2) → download → pikepdf.open → `len(pdf.pages) == 4`.
**Priorité** : P0

---

### P0-004 — Silent success : 21 endpoints TODO retournent success:true avec données fictives
**Fichier** : `app/api/v1/text.py`, `app/api/v1/layers.py`, `app/api/v1/bookmarks.py`, `app/api/v1/forms.py`, `app/api/v1/annotations.py`
**Problème** : 21 endpoints retournent `{"success": true, "data": {...placeholder-uuid...}}` sans aucune opération réelle. Les données retournées sont fictives (`"bookmark_id": "placeholder-uuid"`). Les clients qui parsent la réponse reçoivent de faux IDs et supposent que l'opération a réussi.
**Impact** : Contrat API violé — les clients stockent des IDs `"placeholder-uuid"` non fonctionnels. Pour les mutations (POST de bookmarks, annotations, form fill), les données ne sont jamais persistées.
**Fix** : Les endpoints non implémentés DOIVENT retourner `501 Not Implemented`, pas `200 success: true`. C'est le code HTTP correct pour "endpoint défini mais non implémenté".
```python
# Pattern à appliquer sur tous les TODO handlers
from fastapi import HTTPException

async def create_bookmark(...) -> APIResponse[dict]:
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This feature is under development.",
    )
```
**Liste des 5 endpoints les plus critiques** (ceux qui modifient de la data et mentent) :
1. `POST /documents/{id}/bookmarks` — retourne un faux bookmark_id
2. `POST /documents/{id}/pages/{n}/annotations/markup` — retourne placeholder-uuid
3. `PUT /documents/{id}/forms/fill` — prétend avoir rempli les champs
4. `POST /documents/{id}/layers` — retourne "placeholder-uuid" comme layer_id
5. `POST /documents/{id}/text/replace` — retourne 0 replacements toujours
**Test** : Chaque endpoint doit retourner 501 avec un message clair, pas 200.
**Priorité** : P0

---

### P1-001 — Performance : N+1 pikepdf.open() dans upload_document
**Fichier** : `app/core/pdf_engine.py:202-229` (`get_page`), appelé depuis `app/services/document_service.py:86`
**Problème** : `upload_document()` itère `range(pdf_doc.page_count)` et appelle `self.engine.get_page(document_id, i+1)` pour chaque page. Chaque `get_page()` ouvre le PDF depuis bytes via `pikepdf.open(io.BytesIO(pdf_bytes))` et referme immédiatement. Pour un PDF de 100 pages : 100 ouvertures pikepdf séquentielles + 1 initiale = 101 pikepdf.open() sur les mêmes bytes.
**Impact** : Performance dégradée linéairement avec le nombre de pages. Sur un PDF 200 pages, upload prend O(n) temps pikepdf au lieu de O(1). Sur le chemin le plus chaud (chaque upload et chaque load depuis S3).
**Fix** : Ouvrir le PDF une seule fois et extraire toutes les dimensions en une passe :
```python
# document_service.upload_document() — remplacer la boucle par une passe unique
pdf_bytes_for_parsing = file_data  # déjà validé
pages = []
with pikepdf.open(io.BytesIO(pdf_bytes_for_parsing)) as pdf:
    for i, page in enumerate(pdf.pages):
        mb = page.MediaBox
        w = float(mb[2]) - float(mb[0])
        h = float(mb[3]) - float(mb[1])
        rotation = int(page.get("/Rotate", 0))
        pages.append(PageObject(
            page_id=generate_uuid(),
            page_number=i + 1,
            dimensions=Dimensions(width=w, height=h, rotation=rotation),
            media_box=MediaBox(x=0, y=0, width=w, height=h),
            elements=[],
        ))
```
Supprimer `PDFEngine.get_page()` (0 caller après ce fix sauf tests).
**Test** : Upload PDF 100 pages — vérifier que le temps d'upload < 2× le temps d'un PDF 10 pages.
**Priorité** : P1

---

### P1-002 — Performance : pikepdf.open() bloquant dans async endpoint (storage.py)
**Fichier** : `app/api/v1/storage.py:233`, `app/api/v1/storage.py:1101`
**Problème** : Les endpoints `POST /storage/documents` et `POST /storage/documents/{id}/versions` sont des `async def` FastAPI. Ils appellent `pikepdf.open(io.BytesIO(pdf_bytes))` directement dans le coroutine sans `asyncio.to_thread`. pikepdf.open() est une opération CPU-bound/IO-bound synchrone qui bloque l'event loop pendant l'ouverture du fichier.
**Impact** : Sous charge (plusieurs uploads simultanés), l'event loop est bloqué, retardant toutes les autres requêtes concurrentes (y compris les health checks). Problème de performance sous concurrence.
**Fix** :
```python
import asyncio

# Remplacer le bloc synchrone par un thread offload
page_count = await asyncio.to_thread(_count_pages_sync, pdf_bytes)

def _count_pages_sync(pdf_bytes: bytes) -> int:
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)
```
Même pattern pour `app/repositories/redis_document_repo.py:345` (dans `_load_from_redis`, async context).
**Test** : Benchmark avec httpx AsyncClient — 10 uploads simultanés. Vérifier que le temps total < 10× le temps d'un seul upload.
**Priorité** : P1

---

### P1-003 — Security : encrypt_document retourne success:true sans chiffrer réellement
**Fichier** : `app/api/v1/security.py:247-349`
**Problème** : L'endpoint `POST /documents/{id}/security/encrypt` :
1. Appelle `session.pdf_doc.set_metadata({"encryption": ...})` — **no-op** (log warning uniquement, `LegacyDocumentProxy.set_metadata()` ne fait rien)
2. Appelle `session.pdf_doc.permissions = perm` — **no-op** (setter loggue un warning, `LegacyDocumentProxy.permissions` setter ne fait rien)
3. Stocke les paramètres dans `session.encryption_params` — **non persisté en Redis**, attribut dynamique sur un dataclass non prévu pour ça
4. Retourne `{"encrypted": true}` — **mensonge**

Le document n'est pas chiffré. Si l'utilisateur télécharge le PDF après "chiffrement", le fichier est en clair.
**Impact** : Fausse garantie de sécurité. Utilisateurs pensent avoir protégé leur document, mais le PDF est ouvert sans mot de passe. Risque légal + business critical.
**Fix** :
```python
# Option 1 (rapide) : retourner 501 Not Implemented honnêtement
raise HTTPException(status_code=501, detail="PDF encryption not yet implemented server-side. Use the editor's TS engine for encryption.")

# Option 2 (correct) : implémenter via pikepdf
import pikepdf
output = io.BytesIO()
with pikepdf.open(io.BytesIO(session.pdf_doc.tobytes())) as pdf:
    pdf.save(output,
        encryption=pikepdf.Encryption(
            user=request.user_password or "",
            owner=request.owner_password or "",
            R=6,  # AES-256
        )
    )
new_bytes = output.getvalue()
pdf_engine._documents[document_id] = new_bytes
session.pdf_doc = LegacyDocumentProxy(document_id, new_bytes, session.pdf_doc.page_count, True)
# Persister en Redis via save_session_to_redis
await document_sessions.save_session_to_redis(document_id)
```
**Test** : Encrypt avec password "secret" → download → `pikepdf.open(bytes)` doit lever `PasswordError`. `pikepdf.open(bytes, password="secret")` doit réussir.
**Priorité** : P1

---

### P1-004 — Architecture : reorder_pages utilise session.pdf_doc.select() bypass engine
**Fichier** : `app/services/document_service.py:543`
**Problème** : `session.pdf_doc.select(...)` accède directement au proxy de document via la session au lieu de passer par `self.engine.reorder_pages(document_id, new_order)`. Violation de la séparation des couches : le service accède aux internals de la session plutôt qu'à l'engine.
**Impact** : Le engine ne met pas à jour `self._documents[document_id]` (les bytes restent inchangés). Couplage fort entre `document_service` et l'implémentation interne de `DocumentSession`.
**Fix** : Ajouter `PDFEngine.reorder_pages()` (voir P0-002 pour l'implémentation) et l'appeler via `self.engine.reorder_pages(document_id, new_order)`.
**Priorité** : P1 (lié à P0-002)

---

### P1-005 — Architecture : `_embed_sessions` dict dynamique non-initialisé dans __init__
**Fichier** : `app/repositories/document_repo.py:716-733`
**Problème** : Les méthodes `set_embed_session`, `get_embed_session`, `remove_embed_session` utilisent `hasattr(self, "_embed_sessions")` comme guard au lieu d'initialiser `_embed_sessions` dans `__init__`. Pattern fragile : thread-unsafe (deux threads peuvent passer `hasattr` simultanément avant que l'un initialise), difficile à maintenir, et masque une initialisation manquante.
**Impact** : Race condition potentielle sous concurrence. Le code fonctionne mais est fragile.
**Fix** :
```python
class DocumentSessionManager:
    def __init__(self, ...):
        ...
        self._embed_sessions: dict[str, dict[str, str]] = {}  # Initialiser ici

    def set_embed_session(self, session_id: str, document_id: str, user_id: str) -> None:
        # Supprimer le hasattr guard
        self._embed_sessions[session_id] = {"document_id": document_id, "user_id": user_id}
```
**Priorité** : P1

---

### P1-006 — Logging : 235 print() en production au lieu du logger
**Fichier** : `app/api/v1/storage.py` (24), `app/api/v1/sharing.py` (18), `app/api/v1/text.py` (17), `app/api/v1/billing.py` (14), etc.
**Problème** : Les routeurs FastAPI utilisent massivement `print()` au lieu du logger structuré. `print()` : (1) n'est pas capturé par les systèmes de log (Sentry, Datadog), (2) n'inclut pas le contexte (request_id, user_id, timestamp), (3) non filtrable par niveau, (4) contient parfois des données sensibles (document_ids, user_ids).
**Impact** : Logs de debug visibles sur stdout en production, mais invisibles dans les outils de monitoring. Pertes d'événements critiques dans Sentry.
**Fix** :
```python
# En tête de chaque fichier router — ajouter :
import logging
_logger = logging.getLogger(__name__)

# Remplacer tous les print() par :
print(f"Debug info: {x}")  →  _logger.debug("Debug info: %s", x)
print(f"Error: {e}")        →  _logger.error("Error: %s", e, exc_info=True)
```
Script sed pour migration rapide (à adapter) :
```bash
grep -rn "^\s*print(" app/api/v1/ --include="*.py" -l | xargs sed -i 's/^\(\s*\)print(\(.*\))$/\1_logger.debug(\2)/'
```
**Test** : Vérifier que `caplog` pytest capture les events (pas print).
**Priorité** : P1

---

### P1-007 — Error handling : except Exception trop large dans get_page_image
**Fichier** : `app/services/document_service.py:304`
**Problème** : Le bloc `except Exception as e` dans `get_page_image()` attrape TOUT (y compris `AttributeError` du bug P0-001, `KeyboardInterrupt` via BaseException dans certains cas, ou des erreurs de programmation). Il loggue un warning et lève `NotFoundError` — masquant ainsi le vrai bug `AttributeError`.
**Impact** : Le bug P0-001 est silencieusement transformé en 404 NotFound au lieu d'un 500 visible, retardant le diagnostic.
**Fix** : Remplacer par des exceptions typées :
```python
try:
    img_info = session.pdf_doc.extract_image(image_xref)
    ...
except (ValueError, KeyError, IndexError) as e:
    raise NotFoundError(f"Image {image_xref} not found: {e}") from e
# AttributeError (méthode manquante) doit remonter comme 500, pas être masquée
```
Ou supprimer l'endpoint (voir P0-001).
**Priorité** : P1

---

### P1-008 — Architecture : document_service.get_document() mute les pages en place
**Fichier** : `app/services/document_service.py:167-170`
**Problème** : Dans `get_document()`, quand `include_elements=False` :
```python
for page in doc.pages:
    page.elements = []
```
`doc` est l'objet `scene_graph` live de la session (passé par référence, pas copié). Ce code mute directement les pages de la session, effaçant les éléments pour tous les accès futurs.
**Impact** : Si deux requêtes arrivent sur le même document — l'une avec `include_elements=False` et l'une avec `include_elements=True` — la première peut effacer les éléments pour la seconde. Bug de race condition sur sessions partagées.
**Fix** : Copier le DocumentObject avant de muter :
```python
import copy

if not include_elements:
    # Créer une copie superficielle des pages sans toucher la session
    filtered_pages = []
    for page in doc.pages:
        filtered_pages.append(PageObject(
            page_id=page.page_id,
            page_number=page.page_number,
            dimensions=page.dimensions,
            media_box=page.media_box,
            crop_box=page.crop_box,
            elements=[],
            preview=page.preview,
        ))
    doc = DocumentObject(
        document_id=doc.document_id,
        metadata=doc.metadata,
        pages=filtered_pages,
        outlines=doc.outlines,
        layers=doc.layers,
        embedded_files=doc.embedded_files,
    )
```
**Priorité** : P1

---

### P1-009 — Security / Architecture : DEPRECATED security.py toujours routé et actif
**Fichier** : `app/api/v1/router.py:100-104`, `app/api/v1/security.py:1`
**Problème** : `security.py` est marqué `# DEPRECATED` en ligne 1 mais il est toujours inclus dans le router principal. La plupart de ses opérations (encrypt, decrypt, change_permissions) retournent des faux succès (no-op via LegacyDocumentProxy) avec l'impression d'avoir sécurisé le document.
**Impact** : Des utilisateurs pensent protéger leurs documents alors que l'opération ne fait rien de réel. C'est une garantie de sécurité mensongère.
**Fix** :
- Court terme : Retourner `501 Not Implemented` sur tous les endpoints non-fonctionnels (encrypt, decrypt, change_permissions).
- Moyen terme : Implémenter via pikepdf (voir P1-003) ou supprimer le module.
**Priorité** : P1

---

### P2-001 — Dead code : job_service.py singleton jamais importé
**Fichier** : `app/services/job_service.py:203`
**Problème** : `job_service = JobService()` créé en module-level, mais `app/api/v1/jobs.py` n'importe pas `job_service`. Le service entier est mort.
**Impact** : Code maintenu pour rien, confusion sur l'architecture.
**Fix** : Soit supprimer `job_service.py`, soit importer `job_service` dans `jobs.py` et l'utiliser pour les opérations Celery.
**Priorité** : P2

---

### P2-002 — Dead code : security_audit_service.py jamais importé
**Fichier** : `app/services/security_audit_service.py`
**Problème** : Module complet (enum `SecurityEventType`, classe `SecurityAuditService`, singleton) — 0 importeur externe. Prévu pour tracer les événements sécurité (chiffrement, accès), mais jamais branché.
**Impact** : Les événements sécurité critiques (accès auth, chiffrement) ne sont pas loggués.
**Fix** : Brancher dans `api_key_auth.py` et `security.py` pour logger les événements de sécurité, ou supprimer si la responsabilité est couverte par Sentry.
**Priorité** : P2

---

### P2-003 — Config : 6 settings DEPRECATED jamais lus, toujours parsés
**Fichier** : `app/config.py:129-149`
**Problème** : `stripe_starter_price_id`, `stripe_pro_price_id`, `scw_access_key`, `scw_secret_key`, `scw_default_organization_id`, `scw_default_project_id` sont déclarés dans `Settings` (Pydantic) mais jamais lus dans le code. Les 4 variables SCW sont documentées comme "lues par le CLI scw, pas par Python" — elles ne devraient pas être dans la classe Pydantic Python.
**Impact** : Pollution du modèle de config, confusion sur ce qui est réellement utilisé. Variables sensibles (access keys) déclarées dans le code alors qu'elles ne servent pas.
**Fix** :
```python
# Supprimer de la classe Settings :
# stripe_starter_price_id, stripe_pro_price_id — avec commentaire dans CHANGELOG
# scw_access_key, scw_secret_key, scw_default_organization_id, scw_default_project_id
# Documenter dans infrastructure/README que les vars SCW_ sont pour le CLI uniquement
```
**Priorité** : P2

---

### P2-004 — Performance : PDFEngine.get_document() ouvre le PDF à chaque appel
**Fichier** : `app/core/pdf_engine.py:123-145`
**Problème** : `get_document()` ouvre pikepdf, compte les pages, referme — à chaque appel. Pas de cache sur `page_count` et `is_encrypted`. Appelé potentiellement plusieurs fois pour le même document (history, element operations).
**Impact** : Overhead pikepdf.open() par appel. Sur un document avec de nombreuses opérations d'édition, multiplicité d'ouvertures inutiles.
**Fix** : Stocker `page_count` et `is_encrypted` dans `_documents` comme un tuple ou dataclass :
```python
# Remplacer dict[str, bytes] par dict[str, tuple[bytes, int, bool]]
# self._documents[document_id] = (pdf_bytes, page_count, is_encrypted)
```
Ou mettre en cache avec `functools.lru_cache` sur la paire `(document_id, hash(pdf_bytes[:64]))`.
**Priorité** : P2

---

### P2-005 — Type hints : fonctions publiques sans annotations dans document_repo.py
**Fichier** : `app/repositories/document_repo.py:602-646` (`push_history`)
**Problème** : `push_history()` retourne `None` sans annotation de retour. `_cleanup_old_sessions()`, `_serialize_history()`, `_deserialize_history()` ont des annotations partielles. Pour une interface publique utilisée dans 10+ callers, l'absence d'annotations complique le debugging statique.
**Impact** : mypy/pyright ne peut pas valider les callers. Résilience de refactoring réduite.
**Fix** :
```python
def push_history(
    self,
    document_id: str,
    action: str,
    affected_elements: Optional[list[str]] = None,
    affected_pages: Optional[list[int]] = None,
) -> None:  # ajouter le type de retour
```
**Priorité** : P2

---

### P2-006 — Dead code : PDFEngine.copy_page() et resize_page() — 0 caller
**Fichier** : `app/core/pdf_engine.py:282-417`
**Problème** : `copy_page()` et `resize_page()` ont 0 caller externe (confirmé Phase 1 rapport 03). Elles sont des no-ops qui logguent un warning. `copy_page()` retourne même une valeur (`target_position or 1`) sans aucun effet.
**Impact** : Code mort polluant l'interface publique du module DEPRECATED.
**Fix** : Supprimer les deux méthodes de `PDFEngine`. Si jamais needed, réimplémenter via pikepdf.
**Priorité** : P2

---

### P2-007 — Architecture : imports dynamiques dans les blocs try/except des handlers
**Fichier** : `app/services/document_service.py:155, 197, 283-284, etc.`
**Problème** : Pattern récurrent : `from app.middleware.error_handler import NotFoundError` à l'intérieur d'un `if not session:` ou d'un `except Exception:`. Ces imports devraient être au niveau du module pour éviter le coût à chaque appel et pour que les outils statiques (mypy, IDE) les voient correctement.
**Impact** : Légère pénalité de performance à chaque chemin d'erreur, mais surtout anti-pattern qui masque les dépendances réelles du module.
**Fix** :
```python
# En tête du fichier (avec les autres imports) :
from app.middleware.error_handler import (
    DocumentNotFoundError,
    InvalidOperationError,
    NotFoundError,
    PageNotFoundError,
)
# Supprimer tous les imports locaux dans les blocs if/except
```
**Priorité** : P2

---

### P2-008 — Architecture : preview.py DEPRECATED appelé dans document_service
**Fichier** : `app/services/document_service.py:240-247`, `app/core/preview.py`
**Problème** : `get_page_preview()` instancie `PreviewGenerator(session.pdf_doc)` — module explicitement DEPRECATED qui utilise `pdfplumber` pour le rendu. Le rendu de page est censé être fait par le TypeScript engine. L'endpoint `GET /pages/{n}/preview` est appelé par aucun composant frontend (rapport 03).
**Impact** : Dépendance sur `pdfplumber` pour un code path mort. Si la feature est voulue, pdfplumber produit des previews de moindre qualité que le TS engine.
**Fix** : Supprimer l'endpoint `GET /{page_number}/preview` (aucun caller frontend) OU le proxifier vers le TS engine via `httpx`. Supprimer `PreviewGenerator` et le module `preview.py`.
**Priorité** : P2

---

## Observations transverses

### Couplage document_service → session internals (bypasse engine)
Plusieurs méthodes de `document_service.py` accèdent directement à `session.pdf_doc` (l'objet proxy) au lieu de passer par `self.engine`. Cela viole la séparation entre la couche service et la couche engine :
- `reorder_pages()` : `session.pdf_doc.select(...)` (P0-002)
- `get_page_preview()` : `PreviewGenerator(session.pdf_doc)` (P2-008)
- `security.py` : `session.pdf_doc.set_metadata(...)`, `session.pdf_doc.permissions = ...` (P1-003)

L'engine devrait être l'unique point d'accès aux bytes PDF. Les sessions devraient être des conteneurs opaques.

### Async/sync — La situation est correcte sur le singleton actif
Le singleton `document_sessions` est `RedisDocumentSessionManager` (non `DocumentSessionManager`). Cette classe a des méthodes `async def create_session`, `async def delete_session`, `async def get_session`, `def get_session_sync`. Les appels `await document_sessions.create_session(...)` et `await document_sessions.delete_session(...)` dans `document_service.py` sont CORRECTS. La classe `DocumentSessionManager` (sync) dans `document_repo.py` est une classe legacy non utilisée — source de confusion mais pas de bug actif.

### Les no-ops silent success sont le pattern le plus dangereux
Le pattern `logger.warning(...); return` dans les méthodes DEPRECATED du PDFEngine, combiné avec des handlers API qui retournent `success: true` sans vérification, crée une illusion de fonctionnement. C'est plus dangereux que des erreurs explicites car les utilisateurs pensent que les opérations ont réussi.

---

## Roadmap proposée

### Quick wins (1 PR chacun, < 1h de travail)
1. **501 sur tous les TODO endpoints** (P0-004) — grep + remplacement mécanique
2. **Supprimer `get_page_image()` et sa route** (P0-001) — 2 suppressions de fonctions
3. **Imports en tête de module** (P2-007) — refactoring cosmétique
4. **print() → logger** (P1-006) — script sed + review manuelle

### Refactorings structurants (sprint 1)
1. **Implémenter les 4 opérations pikepdf** (P0-002, P0-003) — add/delete/rotate/reorder dans `PDFEngine`. Environ 80 lignes de code. Tests d'intégration requis (vraie manipulation PDF).
2. **Fix get_document() mutation** (P1-008) — une copie de `DocumentObject` au lieu d'une mutation in-place.
3. **Encrypt réel ou 501** (P1-003, P1-009) — décision architecturale à prendre : implémenter dans Python via pikepdf ou déléguer au TS engine.

### Refactorings architecturaux (sprint 2)
1. **Supprimer preview.py et pdf_engine.py** après que les opérations pikepdf sont implémentées directement dans `PDFEngine` et les routes sans caller sont supprimées.
2. **Éliminer l'accès direct `session.pdf_doc`** depuis les services — forcer tout à passer par `self.engine`.
3. **Tests d'intégration P0** (rapport 04 code déjà fourni) — couvrir le chemin upload/load/download avec un vrai PDF pikepdf.
