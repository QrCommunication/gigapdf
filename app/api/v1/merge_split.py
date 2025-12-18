"""
Multi-document operations endpoints.

Handles merging multiple PDFs and splitting PDFs into separate documents.
"""

import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import generate_uuid, now_utc

router = APIRouter()


class MergeDocumentsRequest(BaseModel):
    """Request to merge multiple PDF documents."""

    document_ids: list[str] = Field(
        description="List of document IDs to merge (in order)",
        min_length=2,
    )
    page_ranges: Optional[list[Optional[str]]] = Field(
        default=None,
        description="Optional page ranges for each document (e.g., ['1-5', None, '10-20'])",
    )
    output_name: Optional[str] = Field(
        default="merged_document.pdf",
        description="Name for the merged document",
    )


class SplitDocumentRequest(BaseModel):
    """Request to split a PDF document."""

    split_points: list[int] = Field(
        description="Page numbers where to split (e.g., [5, 10] creates 3 documents)",
        min_length=1,
    )
    output_names: Optional[list[str]] = Field(
        default=None,
        description="Names for the split documents (optional)",
    )


@router.post(
    "/merge",
    response_model=APIResponse[dict],
    summary="Merge multiple documents",
    description="""
Merge multiple PDF documents into a single document.

You can optionally specify page ranges for each document to merge only
specific pages. The documents are merged in the order provided.

## Request Body
```json
{
  "document_ids": [
    "550e8400-e29b-41d4-a716-446655440001",
    "550e8400-e29b-41d4-a716-446655440002",
    "550e8400-e29b-41d4-a716-446655440003"
  ],
  "page_ranges": ["1-5", null, "10-20"],
  "output_name": "merged_report.pdf"
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/merge" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "document_ids": ["doc1-id", "doc2-id", "doc3-id"],
    "output_name": "merged.pdf"
  }'
```

## Example (Python)
```python
import requests

# Fusionner plusieurs documents PDF
response = requests.post(
    "http://localhost:8000/api/v1/documents/merge",
    headers={"Authorization": "Bearer <token>"},
    json={
        "document_ids": [doc1_id, doc2_id, doc3_id],
        "page_ranges": ["1-5", None, "10-20"],  # Pages spécifiques pour doc1 et doc3
        "output_name": "merged_report.pdf"
    }
)
merged = response.json()["data"]
merged_doc_id = merged["document_id"]

# Le document fusionné est maintenant disponible dans la session
# Vous pouvez le télécharger ou le modifier
download_response = requests.get(
    f"http://localhost:8000/api/v1/documents/{merged_doc_id}/download",
    headers={"Authorization": "Bearer <token>"}
)
with open("merged.pdf", "wb") as f:
    f.write(download_response.content)
```

## Example (JavaScript)
```javascript
// Fusionner des documents
const response = await fetch('/api/v1/documents/merge', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    document_ids: [doc1Id, doc2Id, doc3Id],
    page_ranges: ['1-5', null, '10-20'],
    output_name: 'merged.pdf'
  })
});
const result = await response.json();
const mergedDocId = result.data.document_id;

// Télécharger le document fusionné
const downloadRes = await fetch(
  `/api/v1/documents/${mergedDocId}/download`,
  { headers: { 'Authorization': 'Bearer <token>' } }
);
const blob = await downloadRes.blob();
```

## Example (PHP)
```php
// Fusionner plusieurs documents
$client = new GuzzleHttp\\Client();
$response = $client->post('http://localhost:8000/api/v1/documents/merge', [
    'headers' => [
        'Authorization' => 'Bearer <token>',
        'Content-Type' => 'application/json'
    ],
    'json' => [
        'document_ids' => [$doc1Id, $doc2Id, $doc3Id],
        'page_ranges' => ['1-5', null, '10-20'],
        'output_name' => 'merged.pdf'
    ]
]);
$merged = json_decode($response->getBody(), true)['data'];
$mergedDocId = $merged['document_id'];

// Télécharger le résultat
$downloadRes = $client->get(
    "http://localhost:8000/api/v1/documents/{$mergedDocId}/download",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
file_put_contents('merged.pdf', $downloadRes->getBody());
```
""",
    responses={
        201: {
            "description": "Documents merged successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "770e8400-e29b-41d4-a716-446655440005",
                            "page_count": 25,
                            "filename": "merged_report.pdf",
                            "source_documents": 3,
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid document IDs or page ranges"},
        404: {"description": "One or more documents not found"},
    },
)
async def merge_documents(
    request: MergeDocumentsRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Merge multiple documents into one."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions
    from app.core.pdf_engine import pdf_engine
    from app.core.parser import PDFParser
    from app.utils.helpers import parse_page_range
    import fitz

    # Validate all documents exist
    sessions = []
    for doc_id in request.document_ids:
        session = document_sessions.get_session(doc_id)
        if not session:
            from app.middleware.error_handler import DocumentNotFoundError
            raise DocumentNotFoundError(doc_id)
        sessions.append(session)

    # Create new PDF document for merge
    merged_pdf = fitz.open()

    # Merge documents
    total_pages = 0
    for i, (doc_id, session) in enumerate(zip(request.document_ids, sessions)):
        pdf_doc = session.pdf_doc

        # Determine which pages to include
        if request.page_ranges and i < len(request.page_ranges) and request.page_ranges[i]:
            # Parse page range
            page_range = request.page_ranges[i]
            pages_to_include = parse_page_range(page_range, pdf_doc.page_count)
        else:
            # Include all pages
            pages_to_include = list(range(1, pdf_doc.page_count + 1))

        # Insert pages
        for page_num in pages_to_include:
            merged_pdf.insert_pdf(
                pdf_doc,
                from_page=page_num - 1,
                to_page=page_num - 1,
            )
            total_pages += 1

    # Generate new document ID and register with engine
    merged_doc_id = generate_uuid()
    pdf_engine._documents[merged_doc_id] = merged_pdf

    # Parse the merged document
    parser = PDFParser(merged_doc_id)
    scene_graph = parser.parse_document(merged_pdf)

    # Create session
    owner_id = user.user_id if user else None
    session = document_sessions.create_session(
        document_id=merged_doc_id,
        pdf_doc=merged_pdf,
        scene_graph=scene_graph,
        owner_id=owner_id,
        filename=request.output_name,
        file_size=0,  # Will be calculated on save
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": merged_doc_id,
            "page_count": total_pages,
            "filename": request.output_name,
            "source_documents": len(request.document_ids),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/split",
    response_model=APIResponse[dict],
    summary="Split document",
    description="""
Split a PDF document into multiple separate documents.

Specify page numbers where you want to split. For example, if you have a
20-page document and split at pages [5, 10], you'll get three documents:
- Document 1: pages 1-5
- Document 2: pages 6-10
- Document 3: pages 11-20

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Request Body
```json
{
  "split_points": [5, 10, 15],
  "output_names": [
    "part1.pdf",
    "part2.pdf",
    "part3.pdf",
    "part4.pdf"
  ]
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/split" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "split_points": [5, 10],
    "output_names": ["part1.pdf", "part2.pdf", "part3.pdf"]
  }'
```

## Example (Python)
```python
import requests

# Diviser un document en plusieurs parties
response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/split",
    headers={"Authorization": "Bearer <token>"},
    json={
        "split_points": [5, 10, 15],
        "output_names": ["intro.pdf", "chapter1.pdf", "chapter2.pdf", "conclusion.pdf"]
    }
)
result = response.json()["data"]
split_docs = result["documents"]

# Télécharger chaque partie
for doc in split_docs:
    doc_id = doc["document_id"]
    filename = doc["filename"]
    download_res = requests.get(
        f"http://localhost:8000/api/v1/documents/{doc_id}/download",
        headers={"Authorization": "Bearer <token>"}
    )
    with open(filename, "wb") as f:
        f.write(download_res.content)
```

## Example (JavaScript)
```javascript
// Diviser un document
const response = await fetch(
  `/api/v1/documents/${documentId}/split`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      split_points: [5, 10, 15],
      output_names: ['intro.pdf', 'chapter1.pdf', 'chapter2.pdf', 'conclusion.pdf']
    })
  }
);
const result = await response.json();
const splitDocs = result.data.documents;

// Télécharger chaque partie
for (const doc of splitDocs) {
  const downloadRes = await fetch(
    `/api/v1/documents/${doc.document_id}/download`,
    { headers: { 'Authorization': 'Bearer <token>' } }
  );
  const blob = await downloadRes.blob();
  // Télécharger ou traiter le blob
}
```

## Example (PHP)
```php
// Diviser un document
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/split",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => [
            'split_points' => [5, 10, 15],
            'output_names' => ['intro.pdf', 'chapter1.pdf', 'chapter2.pdf', 'conclusion.pdf']
        ]
    ]
);
$result = json_decode($response->getBody(), true)['data'];
$splitDocs = $result['documents'];

// Télécharger chaque partie
foreach ($splitDocs as $doc) {
    $docId = $doc['document_id'];
    $filename = $doc['filename'];
    $downloadRes = $client->get(
        "http://localhost:8000/api/v1/documents/{$docId}/download",
        ['headers' => ['Authorization' => 'Bearer <token>']]
    );
    file_put_contents($filename, $downloadRes->getBody());
}
```
""",
    responses={
        201: {
            "description": "Document split successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "original_document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "documents": [
                                {
                                    "document_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "filename": "part1.pdf",
                                    "page_count": 5,
                                    "page_range": "1-5",
                                },
                                {
                                    "document_id": "660e8400-e29b-41d4-a716-446655440002",
                                    "filename": "part2.pdf",
                                    "page_count": 5,
                                    "page_range": "6-10",
                                },
                            ],
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid split points"},
        404: {"description": "Document not found"},
    },
)
async def split_document(
    document_id: str,
    request: SplitDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Split document into multiple documents."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions
    from app.core.pdf_engine import pdf_engine
    from app.core.parser import PDFParser
    import fitz

    # Get source document
    session = document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    pdf_doc = session.pdf_doc
    total_pages = pdf_doc.page_count

    # Validate split points
    split_points = sorted(set(request.split_points))
    if any(p < 1 or p > total_pages for p in split_points):
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(
            f"Split points must be between 1 and {total_pages}"
        )

    # Build page ranges for each split document
    ranges = []
    start = 1
    for split_point in split_points:
        if split_point > start:
            ranges.append((start, split_point))
            start = split_point + 1

    # Add final range
    if start <= total_pages:
        ranges.append((start, total_pages))

    # Validate output names
    if request.output_names:
        if len(request.output_names) != len(ranges):
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(
                f"Number of output names ({len(request.output_names)}) must match "
                f"number of resulting documents ({len(ranges)})"
            )
        output_names = request.output_names
    else:
        # Generate default names
        base_name = session.original_filename or "document"
        if base_name.endswith(".pdf"):
            base_name = base_name[:-4]
        output_names = [f"{base_name}_part{i+1}.pdf" for i in range(len(ranges))]

    # Create split documents
    split_docs = []
    owner_id = user.user_id if user else None

    for i, (start_page, end_page) in enumerate(ranges):
        # Create new PDF with pages from range
        split_pdf = fitz.open()
        split_pdf.insert_pdf(
            pdf_doc,
            from_page=start_page - 1,
            to_page=end_page - 1,
        )

        # Generate document ID and register
        split_doc_id = generate_uuid()
        pdf_engine._documents[split_doc_id] = split_pdf

        # Parse the split document
        parser = PDFParser(split_doc_id)
        scene_graph = parser.parse_document(split_pdf)

        # Create session
        split_session = document_sessions.create_session(
            document_id=split_doc_id,
            pdf_doc=split_pdf,
            scene_graph=scene_graph,
            owner_id=owner_id,
            filename=output_names[i],
            file_size=0,
        )

        split_docs.append({
            "document_id": split_doc_id,
            "filename": output_names[i],
            "page_count": end_page - start_page + 1,
            "page_range": f"{start_page}-{end_page}",
        })

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "original_document_id": document_id,
            "documents": split_docs,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
