# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead
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
    summary="Merge multiple PDF documents",
    description="""Combine multiple PDF documents into a single file.

Documents are merged in the order provided. You can optionally specify page ranges
for each document to include only specific pages in the merged result.

## Features
- Merge 2 or more PDF documents into one
- Optionally specify page ranges for selective merging
- Preserve document quality and formatting
- Automatic page numbering in the merged document

## Page Range Syntax
- `"1-5"` - Pages 1 through 5
- `"1,3,5"` - Pages 1, 3, and 5
- `"1-3,7-9"` - Pages 1-3 and 7-9
- `null` - All pages from the document

## Use Cases
- Combining report sections from different sources
- Merging contract pages with signature pages
- Creating document bundles for distribution
- Assembling presentations from multiple files
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
        400: {
            "description": "Invalid request - Less than 2 documents provided, invalid document IDs, or invalid page ranges",
        },
        404: {
            "description": "One or more documents not found in the current session",
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/merge" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "document_ids": [\n      "550e8400-e29b-41d4-a716-446655440001",\n      "550e8400-e29b-41d4-a716-446655440002",\n      "550e8400-e29b-41d4-a716-446655440003"\n    ],\n    "page_ranges": ["1-5", null, "10-20"],\n    "output_name": "merged_report.pdf"\n  }\''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n# Merge multiple PDF documents\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/documents/merge",\n    headers={"Authorization": f"Bearer {token}"},\n    json={\n        "document_ids": [\n            "550e8400-e29b-41d4-a716-446655440001",\n            "550e8400-e29b-41d4-a716-446655440002",\n            "550e8400-e29b-41d4-a716-446655440003"\n        ],\n        "page_ranges": ["1-5", None, "10-20"],  # Specific pages for doc1 and doc3\n        "output_name": "merged_report.pdf"\n    }\n)\nresult = response.json()\nmerged_doc_id = result["data"]["document_id"]\nprint(f"Merged document ID: {merged_doc_id}")\nprint(f"Total pages: {result[\'data\'][\'page_count\']}")\n\n# Download the merged document\ndownload_response = requests.get(\n    f"https://api.giga-pdf.com/api/v1/documents/{merged_doc_id}/download",\n    headers={"Authorization": f"Bearer {token}"}\n)\nwith open("merged_report.pdf", "wb") as f:\n    f.write(download_response.content)'
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '// Merge multiple PDF documents\nconst response = await fetch("https://api.giga-pdf.com/api/v1/documents/merge", {\n  method: "POST",\n  headers: {\n    "Authorization": `Bearer ${token}`,\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    document_ids: [\n      "550e8400-e29b-41d4-a716-446655440001",\n      "550e8400-e29b-41d4-a716-446655440002",\n      "550e8400-e29b-41d4-a716-446655440003"\n    ],\n    page_ranges: ["1-5", null, "10-20"], // Specific pages for doc1 and doc3\n    output_name: "merged_report.pdf"\n  })\n});\n\nconst result = await response.json();\nconst mergedDocId = result.data.document_id;\nconsole.log(`Merged document ID: ${mergedDocId}`);\nconsole.log(`Total pages: ${result.data.page_count}`);\n\n// Download the merged document\nconst downloadResponse = await fetch(\n  `https://api.giga-pdf.com/api/v1/documents/${mergedDocId}/download`,\n  { headers: { "Authorization": `Bearer ${token}` } }\n);\nconst blob = await downloadResponse.blob();\nconst url = URL.createObjectURL(blob);\n// Use the URL to download or display the PDF'
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n// Merge multiple PDF documents\n$ch = curl_init();\n\n$data = [\n    "document_ids" => [\n        "550e8400-e29b-41d4-a716-446655440001",\n        "550e8400-e29b-41d4-a716-446655440002",\n        "550e8400-e29b-41d4-a716-446655440003"\n    ],\n    "page_ranges" => ["1-5", null, "10-20"], // Specific pages for doc1 and doc3\n    "output_name" => "merged_report.pdf"\n];\n\ncurl_setopt_array($ch, [\n    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/merge",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => json_encode($data),\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer " . $token,\n        "Content-Type: application/json"\n    ]\n]);\n\n$response = curl_exec($ch);\n$result = json_decode($response, true);\n$mergedDocId = $result["data"]["document_id"];\necho "Merged document ID: " . $mergedDocId . "\\n";\necho "Total pages: " . $result["data"]["page_count"] . "\\n";\n\n// Download the merged document\ncurl_setopt_array($ch, [\n    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$mergedDocId}/download",\n    CURLOPT_POST => false,\n    CURLOPT_POSTFIELDS => null\n]);\n\n$pdfContent = curl_exec($ch);\nfile_put_contents("merged_report.pdf", $pdfContent);\ncurl_close($ch);\n?>'
            },
        ]
    },
)
async def merge_documents(
    request: MergeDocumentsRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Merge multiple PDF documents into a single document.

    This endpoint combines two or more PDF documents into one unified file.
    Documents are merged in the order specified in the document_ids array.
    You can optionally specify page ranges to include only specific pages
    from each source document.

    Args:
        request: MergeDocumentsRequest containing document IDs, optional page ranges,
                 and output filename.
        user: Optional authenticated user for ownership tracking.

    Returns:
        APIResponse containing the merged document ID, page count, filename,
        and number of source documents.

    Raises:
        DocumentNotFoundError: If any of the specified documents are not found.
        InvalidOperationError: If page ranges are invalid or out of bounds.
    """
    start_time = time.time()

    from app.repositories.document_repo import document_sessions
    from app.core.pdf_engine import pdf_engine
    from app.core.parser import PDFParser
    from app.utils.helpers import parse_page_range
    # DEPRECATED: import fitz
    try:
        import fitz
    except ImportError:
        fitz = None  # type: ignore[assignment]

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
    summary="Split a PDF document into multiple parts",
    description="""Split a single PDF document into multiple separate documents at specified page boundaries.

Specify the page numbers where you want to split the document. The split points define
where each new document ends. For example, splitting a 20-page document at pages [5, 10]
creates three documents:
- Document 1: pages 1-5
- Document 2: pages 6-10
- Document 3: pages 11-20

## Features
- Split at any page boundary
- Multiple split points supported
- Custom naming for output documents
- Preserves document quality and formatting

## Split Point Rules
- Split points must be valid page numbers (1 to total pages)
- Duplicate split points are automatically deduplicated
- Split points are automatically sorted in ascending order

## Use Cases
- Extracting chapters from a book
- Separating sections of a report
- Breaking up large documents for easier sharing
- Creating individual documents from scanned batches
""",
    responses={
        201: {
            "description": "Document split successfully into multiple parts",
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
                                {
                                    "document_id": "660e8400-e29b-41d4-a716-446655440003",
                                    "filename": "part3.pdf",
                                    "page_count": 10,
                                    "page_range": "11-20",
                                },
                            ],
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {
            "description": "Invalid split points - out of range, or output names count mismatch",
        },
        404: {
            "description": "Document not found in the current session",
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440000/split" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "split_points": [5, 10, 15],\n    "output_names": ["intro.pdf", "chapter1.pdf", "chapter2.pdf", "conclusion.pdf"]\n  }\''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ndocument_id = "550e8400-e29b-41d4-a716-446655440000"\n\n# Split a document into multiple parts\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/split",\n    headers={"Authorization": f"Bearer {token}"},\n    json={\n        "split_points": [5, 10, 15],\n        "output_names": ["intro.pdf", "chapter1.pdf", "chapter2.pdf", "conclusion.pdf"]\n    }\n)\nresult = response.json()\nsplit_docs = result["data"]["documents"]\n\nprint(f"Created {len(split_docs)} documents from original")\n\n# Download each split document\nfor doc in split_docs:\n    doc_id = doc["document_id"]\n    filename = doc["filename"]\n    print(f"Downloading {filename} ({doc[\'page_count\']} pages, {doc[\'page_range\']})")\n\n    download_response = requests.get(\n        f"https://api.giga-pdf.com/api/v1/documents/{doc_id}/download",\n        headers={"Authorization": f"Bearer {token}"}\n    )\n    with open(filename, "wb") as f:\n        f.write(download_response.content)'
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const documentId = "550e8400-e29b-41d4-a716-446655440000";\n\n// Split a document into multiple parts\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/documents/${documentId}/split`,\n  {\n    method: "POST",\n    headers: {\n      "Authorization": `Bearer ${token}`,\n      "Content-Type": "application/json"\n    },\n    body: JSON.stringify({\n      split_points: [5, 10, 15],\n      output_names: ["intro.pdf", "chapter1.pdf", "chapter2.pdf", "conclusion.pdf"]\n    })\n  }\n);\n\nconst result = await response.json();\nconst splitDocs = result.data.documents;\n\nconsole.log(`Created ${splitDocs.length} documents from original`);\n\n// Download each split document\nfor (const doc of splitDocs) {\n  console.log(`Downloading ${doc.filename} (${doc.page_count} pages, ${doc.page_range})`);\n\n  const downloadResponse = await fetch(\n    `https://api.giga-pdf.com/api/v1/documents/${doc.document_id}/download`,\n    { headers: { "Authorization": `Bearer ${token}` } }\n  );\n\n  const blob = await downloadResponse.blob();\n  // Create download link or process the blob\n  const url = URL.createObjectURL(blob);\n  const a = document.createElement("a");\n  a.href = url;\n  a.download = doc.filename;\n  a.click();\n}'
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$documentId = "550e8400-e29b-41d4-a716-446655440000";\n\n// Split a document into multiple parts\n$ch = curl_init();\n\n$data = [\n    "split_points" => [5, 10, 15],\n    "output_names" => ["intro.pdf", "chapter1.pdf", "chapter2.pdf", "conclusion.pdf"]\n];\n\ncurl_setopt_array($ch, [\n    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/split",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => json_encode($data),\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer " . $token,\n        "Content-Type: application/json"\n    ]\n]);\n\n$response = curl_exec($ch);\n$result = json_decode($response, true);\n$splitDocs = $result["data"]["documents"];\n\necho "Created " . count($splitDocs) . " documents from original\\n";\n\n// Download each split document\nforeach ($splitDocs as $doc) {\n    $docId = $doc["document_id"];\n    $filename = $doc["filename"];\n    echo "Downloading {$filename} ({$doc[\'page_count\']} pages, {$doc[\'page_range\']})\\n";\n\n    curl_setopt_array($ch, [\n        CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$docId}/download",\n        CURLOPT_POST => false,\n        CURLOPT_POSTFIELDS => null\n    ]);\n\n    $pdfContent = curl_exec($ch);\n    file_put_contents($filename, $pdfContent);\n}\n\ncurl_close($ch);\n?>'
            },
        ]
    },
)
async def split_document(
    document_id: str,
    request: SplitDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """
    Split a PDF document into multiple separate documents.

    This endpoint divides a single PDF document into multiple parts based on
    specified split points. Each split point defines where one document ends
    and the next begins.

    Args:
        document_id: The UUID of the document to split.
        request: SplitDocumentRequest containing split points and optional output names.
        user: Optional authenticated user for ownership tracking.

    Returns:
        APIResponse containing the original document ID and an array of
        created documents with their IDs, filenames, page counts, and page ranges.

    Raises:
        DocumentNotFoundError: If the specified document is not found.
        InvalidOperationError: If split points are out of range or output names
                               count doesn't match the number of resulting documents.
    """
    start_time = time.time()

    from app.repositories.document_repo import document_sessions
    from app.core.pdf_engine import pdf_engine
    from app.core.parser import PDFParser
    # DEPRECATED: import fitz
    try:
        import fitz
    except ImportError:
        fitz = None  # type: ignore[assignment]

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
