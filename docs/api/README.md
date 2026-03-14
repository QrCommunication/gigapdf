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

### Run OCR / Exécuter l'OCR

Extract text from scanned documents.

```http
POST /api/v1/documents/{document_id}/ocr
```

#### Body / Corps

```json
{
  "languages": ["eng", "fra"],
  "pages": [1, 2, 3],
  "output_format": "searchable_pdf"
}
```

#### Options / Options

| Parameter | Type | Description |
|-----------|------|-------------|
| `languages` | array | ISO 639-3 language codes |
| `pages` | array | Page numbers (empty for all) |
| `output_format` | string | `text`, `searchable_pdf`, `hocr` |

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
