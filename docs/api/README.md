# API Reference / Référence API

Complete REST API documentation for GigaPDF.

Documentation complète de l'API REST de GigaPDF.

---

## Table of Contents / Table des matières

1. [Overview / Aperçu](#overview--aperçu)
2. [Authentication / Authentification](#authentication--authentification)
3. [Documents](#documents)
4. [Pages](#pages)
5. [Elements](#elements)
6. [Text Operations](#text-operations)
7. [PDF Modification](#pdf-modification)
8. [Annotations](#annotations)
9. [Forms](#forms)
10. [Merge & Split](#merge--split)
11. [Export](#export)
12. [OCR](#ocr)
13. [Storage](#storage)
14. [Billing](billing.md)
15. [Webhooks](#webhooks)
16. [Error Handling](#error-handling)

---

## Overview / Aperçu

### Base URL / URL de base

```
Production: https://api.your-domain.com/api/v1
Development: http://localhost:8000/api/v1
```

### Interactive Documentation / Documentation interactive

| URL | Description |
|-----|-------------|
| `/api/docs` | Swagger UI (interactive) |
| `/api/redoc` | ReDoc (reference) |
| `/api/v1/openapi.json` | OpenAPI specification |

### Response Format / Format de réponse

All API responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "Document with ID 'abc123' not found",
    "details": {}
  },
  "meta": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

---

## Authentication / Authentification

All API endpoints (except public endpoints) require JWT authentication.

### Request Header / En-tête de requête

```http
Authorization: Bearer <your_jwt_token>
```

### Examples / Exemples

#### cURL

```bash
curl -X GET "https://api.your-domain.com/api/v1/documents" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Content-Type: application/json"
```

#### JavaScript

```javascript
const response = await fetch('https://api.your-domain.com/api/v1/documents', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

#### Python

```python
import requests

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

response = requests.get(
    'https://api.your-domain.com/api/v1/documents',
    headers=headers
)

data = response.json()
```

#### PHP

```php
<?php
$token = 'your_jwt_token';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://api.your-domain.com/api/v1/documents');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token,
    'Content-Type: application/json'
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
```

---

## Documents

### Upload Document / Téléverser un document

Upload a PDF document for editing.

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

#### Parameters / Paramètres

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Yes | PDF file to upload |
| `name` | string | No | Custom document name |

#### Examples / Exemples

**cURL:**
```bash
curl -X POST "https://api.your-domain.com/api/v1/documents/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@document.pdf" \
  -F "name=My Document"
```

**JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('name', 'My Document');

const response = await fetch('/api/v1/documents/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

**Python:**
```python
import requests

files = {'file': open('document.pdf', 'rb')}
data = {'name': 'My Document'}

response = requests.post(
    'https://api.your-domain.com/api/v1/documents/upload',
    headers={'Authorization': f'Bearer {token}'},
    files=files,
    data=data
)
```

**PHP:**
```php
<?php
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://api.your-domain.com/api/v1/documents/upload');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'file' => new CURLFile('document.pdf'),
    'name' => 'My Document'
]);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "id": "doc_123abc",
    "name": "My Document",
    "filename": "document.pdf",
    "page_count": 5,
    "size_bytes": 1048576,
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}
```

---

### Get Document / Obtenir un document

Retrieve document metadata and structure.

```http
GET /api/v1/documents/{document_id}
```

#### Examples / Exemples

**cURL:**
```bash
curl -X GET "https://api.your-domain.com/api/v1/documents/doc_123abc" \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
const response = await fetch(`/api/v1/documents/${documentId}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Python:**
```python
response = requests.get(
    f'https://api.your-domain.com/api/v1/documents/{document_id}',
    headers={'Authorization': f'Bearer {token}'}
)
```

**PHP:**
```php
<?php
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "https://api.your-domain.com/api/v1/documents/{$documentId}");
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "id": "doc_123abc",
    "name": "My Document",
    "filename": "document.pdf",
    "page_count": 5,
    "size_bytes": 1048576,
    "pages": [
      {
        "number": 1,
        "width": 612,
        "height": 792,
        "rotation": 0
      }
    ],
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}
```

---

### Download Document / Télécharger un document

Download the PDF file.

```http
GET /api/v1/documents/{document_id}/download
```

#### Examples / Exemples

**cURL:**
```bash
curl -X GET "https://api.your-domain.com/api/v1/documents/doc_123abc/download" \
  -H "Authorization: Bearer $TOKEN" \
  -o downloaded.pdf
```

**JavaScript:**
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/download`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const blob = await response.blob();
const url = URL.createObjectURL(blob);
```

**Python:**
```python
response = requests.get(
    f'https://api.your-domain.com/api/v1/documents/{document_id}/download',
    headers={'Authorization': f'Bearer {token}'}
)
with open('downloaded.pdf', 'wb') as f:
    f.write(response.content)
```

---

### Delete Document / Supprimer un document

```http
DELETE /api/v1/documents/{document_id}
```

#### Examples / Exemples

**cURL:**
```bash
curl -X DELETE "https://api.your-domain.com/api/v1/documents/doc_123abc" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Pages

### Get Page / Obtenir une page

```http
GET /api/v1/documents/{document_id}/pages/{page_number}
```

### Get Page Preview / Obtenir l'aperçu d'une page

Get a rendered image preview of the page.

```http
GET /api/v1/documents/{document_id}/pages/{page_number}/preview
```

#### Query Parameters / Paramètres de requête

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dpi` | integer | 150 | Resolution (72-600) |
| `format` | string | "png" | Image format (png, jpeg) |

#### Examples / Exemples

**cURL:**
```bash
curl -X GET "https://api.your-domain.com/api/v1/documents/doc_123abc/pages/1/preview?dpi=300&format=png" \
  -H "Authorization: Bearer $TOKEN" \
  -o preview.png
```

---

### Add Page / Ajouter une page

```http
POST /api/v1/documents/{document_id}/pages
```

#### Body / Corps

```json
{
  "position": 2,
  "width": 612,
  "height": 792,
  "template": "blank"
}
```

---

### Delete Page / Supprimer une page

```http
DELETE /api/v1/documents/{document_id}/pages/{page_number}
```

---

### Reorder Pages / Réorganiser les pages

```http
PUT /api/v1/documents/{document_id}/pages/reorder
```

#### Body / Corps

```json
{
  "order": [3, 1, 2, 4, 5]
}
```

---

### Rotate Page / Pivoter une page

```http
PUT /api/v1/documents/{document_id}/pages/{page_number}/rotate
```

#### Body / Corps

```json
{
  "angle": 90
}
```

---

## Elements

### List Elements / Lister les éléments

```http
GET /api/v1/documents/{document_id}/pages/{page_number}/elements
```

---

### Create Element / Créer un élément

```http
POST /api/v1/documents/{document_id}/pages/{page_number}/elements
```

#### Body / Corps

```json
{
  "type": "text",
  "x": 100,
  "y": 200,
  "width": 300,
  "height": 50,
  "content": "Hello World",
  "style": {
    "font_family": "Helvetica",
    "font_size": 14,
    "color": "#000000"
  }
}
```

Element types: `text`, `image`, `shape`, `signature`, `stamp`

---

### Update Element / Modifier un élément

```http
PATCH /api/v1/documents/{document_id}/elements/{element_id}
```

#### Body / Corps

```json
{
  "x": 150,
  "content": "Updated text"
}
```

---

### Delete Element / Supprimer un élément

```http
DELETE /api/v1/documents/{document_id}/elements/{element_id}
```

---

## Text Operations

### Search Text / Rechercher du texte

Search for text within a PDF document with advanced options.

```http
POST /api/v1/documents/{document_id}/text/search
```

#### Body / Corps

```json
{
  "query": "chapter",
  "regex": false,
  "case_sensitive": false,
  "whole_word": true,
  "page_range": "1-10"
}
```

#### Parameters / Paramètres

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Text to search for |
| `regex` | boolean | false | Use regex pattern matching |
| `case_sensitive` | boolean | false | Case sensitive search |
| `whole_word` | boolean | false | Match whole words only |
| `page_range` | string | null | Page range filter (e.g., "1-5,10") |

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "page_number": 1,
        "element_id": "txt-001-abc123",
        "bounds": {"x": 100, "y": 200, "width": 50, "height": 20},
        "matched_text": "introduction",
        "context": "...the introduction to this chapter covers..."
      }
    ],
    "total_matches": 15,
    "pages_searched": 10
  }
}
```

---

### Replace Text / Remplacer du texte

Search and replace text within a PDF document.

```http
POST /api/v1/documents/{document_id}/text/replace
```

#### Body / Corps

```json
{
  "search": "Acme Corporation",
  "replace": "NewCo Industries",
  "regex": false,
  "case_sensitive": true,
  "whole_word": true,
  "max_replacements": 100
}
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "replacements_made": 5,
    "pages_affected": [1, 3, 5, 12],
    "replaced_elements": ["txt-001-abc123", "txt-002-def456"]
  }
}
```

---

### Extract Text / Extraire du texte

Extract all text content from a PDF document.

```http
GET /api/v1/documents/{document_id}/text/extract
```

#### Query Parameters / Paramètres de requête

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page_range` | string | null | Page range filter |
| `include_formatting` | boolean | false | Include font/style information |
| `preserve_layout` | boolean | true | Preserve original text layout |

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "page_number": 1,
        "text": "Chapter 1: Introduction\n\nThis document provides...",
        "elements": [
          {
            "element_id": "txt-001-abc123",
            "content": "Chapter 1: Introduction",
            "bounds": {"x": 100, "y": 50, "width": 200, "height": 24},
            "style": {"font": "Helvetica-Bold", "size": 18}
          }
        ]
      }
    ],
    "full_text": "Chapter 1: Introduction\n\nThis document provides...",
    "total_pages": 10,
    "total_characters": 5432
  }
}
```

---

## PDF Modification

### Modify Document / Modifier un document

Apply batch modifications to a PDF document. Supports adding, updating, and deleting elements (text, images, shapes, annotations) on specific pages.

```http
POST /api/v1/documents/{document_id}/modify
```

#### Body / Corps

```json
{
  "operations": [
    {
      "action": "add",
      "element_type": "text",
      "page_number": 1,
      "element": {
        "content": "Hello World",
        "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
        "style": {
          "font_family": "Helvetica",
          "font_size": 14,
          "color": "#000000"
        }
      }
    },
    {
      "action": "update",
      "element_type": "text",
      "page_number": 2,
      "element_id": "txt-001-abc123",
      "element": {
        "content": "Updated text",
        "bounds": {"x": 100, "y": 200, "width": 300, "height": 50},
        "style": {"font_size": 16}
      },
      "old_bounds": {"x": 100, "y": 200, "width": 300, "height": 50}
    },
    {
      "action": "delete",
      "element_type": "annotation",
      "page_number": 3,
      "element_id": "ann-002-def456"
    }
  ]
}
```

#### Operation Fields / Champs d'opération

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | `add`, `update`, or `delete` |
| `element_type` | string | Yes | `text`, `image`, `shape`, or `annotation` |
| `page_number` | integer | Yes | Target page (1-indexed) |
| `element` | object | add/update | Element data with `content`, `bounds`, `style` |
| `element_id` | string | update/delete | ID of existing element |
| `old_bounds` | object | update | Previous position/dimensions |

#### Element Style / Style d'élément

| Property | Type | Description |
|----------|------|-------------|
| `font_family` | string | Font name (e.g., "Helvetica") |
| `font_size` | number | Size in points (1-1000) |
| `color` | string | Hex color (#RRGGBB) |
| `opacity` | number | 0.0 to 1.0 |
| `bold` | boolean | Bold text |
| `italic` | boolean | Italic text |
| `fill_color` | string | Shape fill color |
| `line_width` | number | Stroke width |

#### Examples / Exemples

**cURL:**
```bash
curl -X POST "https://api.your-domain.com/api/v1/documents/doc_123abc/modify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {
        "action": "add",
        "element_type": "text",
        "page_number": 1,
        "element": {
          "content": "Confidential",
          "bounds": {"x": 200, "y": 400, "width": 200, "height": 30},
          "style": {"font_size": 18, "color": "#FF0000", "opacity": 0.5},
          "rotation": -45
        }
      }
    ]
  }'
```

**JavaScript:**
```javascript
const response = await fetch(`/api/v1/documents/${documentId}/modify`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    operations: [
      {
        action: 'add',
        element_type: 'image',
        page_number: 1,
        element: {
          content: 'data:image/png;base64,...',
          bounds: { x: 400, y: 50, width: 100, height: 100 }
        }
      }
    ]
  })
});
```

**Python:**
```python
response = requests.post(
    f'https://api.your-domain.com/api/v1/documents/{document_id}/modify',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    json={
        'operations': [
            {
                'action': 'add',
                'element_type': 'text',
                'page_number': 1,
                'element': {
                    'content': 'Watermark',
                    'bounds': {'x': 200, 'y': 400, 'width': 200, 'height': 30},
                    'style': {'font_size': 48, 'color': '#CCCCCC', 'opacity': 0.3},
                    'rotation': -45
                }
            }
        ]
    }
)
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "document_id": "doc_123abc",
    "total_operations": 3,
    "successful": 2,
    "failed": 1,
    "results": [
      {
        "index": 0,
        "action": "add",
        "element_type": "text",
        "page_number": 1,
        "status": "success",
        "element_id": "txt-new-001"
      },
      {
        "index": 1,
        "action": "update",
        "element_type": "text",
        "page_number": 2,
        "status": "success",
        "element_id": "txt-001-abc123"
      },
      {
        "index": 2,
        "action": "delete",
        "element_type": "annotation",
        "page_number": 3,
        "status": "error",
        "error": "Element not found: ann-002-def456"
      }
    ]
  }
}
```

---

## Annotations

### List Annotations / Lister les annotations

```http
GET /api/v1/documents/{document_id}/pages/{page_number}/elements?type=annotation
```

Annotations are managed through the Elements API with `type=annotation`.

### Create Annotation / Créer une annotation

```http
POST /api/v1/documents/{document_id}/pages/{page_number}/elements
```

#### Body / Corps

```json
{
  "type": "annotation",
  "x": 100,
  "y": 200,
  "width": 200,
  "height": 50,
  "content": "This is a note",
  "style": {
    "color": "#FFFF00",
    "opacity": 0.5
  },
  "annotation_type": "highlight"
}
```

#### Annotation Types / Types d'annotations

| Type | Description |
|------|-------------|
| `highlight` | Text highlight |
| `underline` | Text underline |
| `strikeout` | Text strikethrough |
| `note` | Sticky note |
| `stamp` | Stamp annotation |
| `link` | Hyperlink |
| `freetext` | Free text annotation |

Annotations can also be added or removed via the [PDF Modification](#pdf-modification) endpoint using batch operations.

---

## Merge & Split

### Merge Documents / Fusionner des documents

Combine multiple PDFs into one.

```http
POST /api/v1/documents/merge
```

#### Body / Corps

```json
{
  "document_ids": ["doc_123", "doc_456", "doc_789"],
  "name": "Merged Document"
}
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "id": "doc_merged_abc",
    "name": "Merged Document",
    "page_count": 15
  }
}
```

---

### Split Document / Diviser un document

Extract pages from a document.

```http
POST /api/v1/documents/{document_id}/split
```

#### Body / Corps

```json
{
  "ranges": [
    {"start": 1, "end": 3},
    {"start": 5, "end": 5},
    {"start": 8, "end": 10}
  ]
}
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "documents": [
      {"id": "doc_split_1", "page_count": 3},
      {"id": "doc_split_2", "page_count": 1},
      {"id": "doc_split_3", "page_count": 3}
    ]
  }
}
```

---

## Export

### Export Document / Exporter un document

Convert PDF to other formats.

```http
POST /api/v1/documents/{document_id}/export
```

#### Body / Corps

```json
{
  "format": "docx",
  "options": {
    "include_images": true,
    "preserve_layout": true
  }
}
```

#### Supported Formats / Formats supportés

| Format | Description |
|--------|-------------|
| `png` | PNG images (one per page) |
| `jpeg` | JPEG images (one per page) |
| `docx` | Microsoft Word |
| `html` | HTML document |
| `txt` | Plain text |
| `svg` | SVG vector graphics |

---

## OCR

OCR runs **client-side** inside the in-house `@qrcommunication/gigapdf-lib`
WASM engine (a zero-dependency CNN model — no Tesseract or any third-party OCR
binary). The extracted `{page, bbox, text}` blocks are then ingested by the API
to power full-text and semantic search.

L'OCR s'exécute **côté client** dans le moteur WASM `@qrcommunication/gigapdf-lib`
(modèle CNN zéro dépendance — aucun binaire OCR tiers type Tesseract). Les blocs
extraits sont ensuite ingérés par l'API pour alimenter la recherche.

### Index OCR blocks / Indexer les blocs OCR

Stores OCR text blocks produced by the client (idempotent **replace** of the
existing index for the document; max 5000 blocks per request).

```http
POST /api/v1/storage/documents/{stored_document_id}/ocr-blocks
```

#### Body / Corps

```json
{
  "blocks": [
    { "page": 1, "bbox": [12.0, 34.0, 210.0, 48.0], "text": "Invoice #123" }
  ]
}
```

Indexed blocks are searchable via `POST /api/v1/search/semantic`
(vector similarity, owner-scoped) — see the Search section.

---

## Storage

### List Documents / Lister les documents

```http
GET /api/v1/storage/documents
```

#### Query Parameters / Paramètres de requête

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `per_page` | integer | 20 | Items per page (max 100) |
| `sort` | string | "created_at" | Sort field |
| `order` | string | "desc" | Sort order (asc/desc) |

---

### Get Storage Usage / Obtenir l'utilisation du stockage

```http
GET /api/v1/storage/usage
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "used_bytes": 104857600,
    "quota_bytes": 1073741824,
    "document_count": 25,
    "usage_percentage": 9.77
  }
}
```

---

## Webhooks

### Webhook Events / Événements Webhook

Configure webhooks to receive real-time notifications.

| Event | Description |
|-------|-------------|
| `document.created` | Document uploaded |
| `document.updated` | Document modified |
| `document.deleted` | Document deleted |
| `export.completed` | Export job finished |
| `ocr.completed` | OCR processing finished |

### Webhook Payload / Charge utile Webhook

```json
{
  "event": "document.created",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "document_id": "doc_123abc",
    "user_id": "user_456"
  },
  "signature": "sha256=..."
}
```

---

## Error Handling

### Error Codes / Codes d'erreur

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `DOCUMENT_NOT_FOUND` | 404 | Document does not exist |
| `PAGE_NOT_FOUND` | 404 | Page does not exist |
| `ELEMENT_NOT_FOUND` | 404 | Element does not exist |
| `VALIDATION_ERROR` | 422 | Invalid request data |
| `QUOTA_EXCEEDED` | 429 | Storage quota exceeded |
| `FILE_TOO_LARGE` | 413 | File exceeds size limit |
| `INVALID_FILE_TYPE` | 415 | Not a valid PDF file |
| `INTERNAL_ERROR` | 500 | Server error |

### Error Response Example / Exemple de réponse d'erreur

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "field": "page_number",
      "error": "Page number must be between 1 and 10"
    }
  }
}
```

---

## Rate Limits / Limites de débit

| Plan | Requests/minute | Requests/hour |
|------|-----------------|---------------|
| Free | 60 | 1,000 |
| Starter | 120 | 5,000 |
| Pro | 300 | 20,000 |
| Enterprise | Custom | Custom |

Rate limit headers:

```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 115
X-RateLimit-Reset: 1705312200
```

---

## Next.js Processing Routes (`/api/pdf/*`)

These routes run inside the **Next.js** runtime (port 3000) and are handled by
the TypeScript PDF engine (`packages/pdf-engine` + `@qrcommunication/gigapdf-lib`
WASM). They are **distinct from the FastAPI REST API** (`/api/v1/*`): they require
a valid user **session cookie** (not a Bearer token) and are not covered by the
OpenAPI spec at `/api/docs`.

Ces routes s'exécutent dans le **runtime Next.js** (port 3000) via le moteur PDF
TypeScript. Elles nécessitent un **cookie de session** valide (pas un token
Bearer) et ne figurent pas dans la spec OpenAPI FastAPI.

---

### Universal merge / Fusion universelle

Merge any combination of supported file types into a single PDF. Every non-PDF
file is converted automatically before merging.

Fusionner n'importe quelle combinaison de fichiers supportés en un seul PDF.
Chaque fichier non-PDF est converti automatiquement avant la fusion.

```http
POST /api/pdf/merge-universal
Content-Type: multipart/form-data
Cookie: session=<session_cookie>
```

**Supported input formats / Formats acceptés:**
PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT, ODT, ODS, ODP,
JPG/JPEG, PNG, GIF, WebP, AVIF, HTML, TXT, RTF

#### Parameters / Paramètres

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files[]` | file[] | Yes | Files to merge (heterogeneous types allowed) |
| `outputName` | string | No | Name of the resulting PDF file |

#### Examples / Exemples

**cURL:**
```bash
curl -X POST "https://giga-pdf.com/api/pdf/merge-universal" \
  -b "session=$SESSION" \
  -F "files[]=@report.pdf" \
  -F "files[]=@data.xlsx" \
  -F "files[]=@photo.png" \
  -F "outputName=merged.pdf" \
  --output merged.pdf
```

**JavaScript:**
```javascript
const formData = new FormData();
formData.append('files[]', pdfFile);
formData.append('files[]', xlsxFile);
formData.append('files[]', pngFile);
formData.append('outputName', 'merged.pdf');

const response = await fetch('/api/pdf/merge-universal', {
  method: 'POST',
  body: formData,
  credentials: 'include'   // sends session cookie
});

const blob = await response.blob();
```

**Response / Réponse:** `200 OK` — `application/pdf` binary

---

### Image to PDF / Image en PDF

Convert one or more images to a single PDF. Supports full color depth,
transparency (PNG), interlacing, and all common image formats.

Convertir une ou plusieurs images en un seul PDF. Supporte la transparence
(PNG), l'interlacement et tous les formats d'images courants.

```http
POST /api/pdf/image-to-pdf
Content-Type: multipart/form-data
Cookie: session=<session_cookie>
```

**Supported formats / Formats acceptés:** JPG/JPEG, PNG (including RGBA), GIF, WebP, AVIF

#### Parameters / Paramètres

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files[]` | file[] | Yes | Image files (one page per image) |
| `outputName` | string | No | Name of the resulting PDF file |

#### Examples / Exemples

**cURL:**
```bash
curl -X POST "https://giga-pdf.com/api/pdf/image-to-pdf" \
  -b "session=$SESSION" \
  -F "files[]=@page1.png" \
  -F "files[]=@page2.jpg" \
  -F "outputName=images.pdf" \
  --output images.pdf
```

**JavaScript:**
```javascript
const formData = new FormData();
images.forEach(img => formData.append('files[]', img));
formData.append('outputName', 'images.pdf');

const response = await fetch('/api/pdf/image-to-pdf', {
  method: 'POST',
  body: formData,
  credentials: 'include'
});
```

**Response / Réponse:** `200 OK` — `application/pdf` binary

---

### PDF to images / PDF en images

Rasterize each page of a PDF as a PNG and return them in a single ZIP archive.

Rasteriser chaque page d'un PDF en PNG et les retourner dans une archive ZIP.

```http
POST /api/pdf/to-image
Content-Type: multipart/form-data
Cookie: session=<session_cookie>
```

#### Parameters / Paramètres

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Yes | PDF file to rasterize |
| `scale` | number | No | Render scale factor (default `2.0`) |

#### Examples / Exemples

**cURL:**
```bash
curl -X POST "https://giga-pdf.com/api/pdf/to-image" \
  -b "session=$SESSION" \
  -F "file=@document.pdf" \
  -F "scale=2" \
  --output pages.zip
```

**JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('scale', '2');

const response = await fetch('/api/pdf/to-image', {
  method: 'POST',
  body: formData,
  credentials: 'include'
});

const blob = await response.blob();   // ZIP containing page-1.png, page-2.png …
```

**Response / Réponse:** `200 OK` — `application/zip`
Each entry inside the archive is named `page-<N>.png` (1-indexed).
Chaque entrée dans l'archive est nommée `page-<N>.png` (index 1).

---

## SDKs & Libraries / SDKs et bibliothèques

### Official SDKs

- **JavaScript/TypeScript**: `@giga-pdf/api` (npm)
- **Python**: `gigapdf` (PyPI)

### Community SDKs

Coming soon...

---

## Support / Assistance

- **API Issues**: [GitHub Issues](https://github.com/your-org/gigapdf/issues)
- **Documentation**: [docs.gigapdf.com](https://docs.gigapdf.com)
- **Status Page**: [status.gigapdf.com](https://status.gigapdf.com)
