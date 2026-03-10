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
6. [Annotations](#annotations)
7. [Forms](#forms)
8. [Merge & Split](#merge--split)
9. [Export](#export)
10. [OCR](#ocr)
11. [Storage](#storage)
12. [Billing](billing.md)
13. [Webhooks](#webhooks)
14. [Error Handling](#error-handling)

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
