"""
Text operations endpoints.

Handles text search, replacement, and extraction from PDF documents.
"""

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc
from pydantic import BaseModel, Field

router = APIRouter()


class OCRRequest(BaseModel):
    """Request to perform OCR on a document."""

    pages: Optional[list[int]] = Field(
        default=None,
        description="Specific page numbers to process (1-indexed). If null, processes all pages."
    )
    language: str = Field(
        default="eng",
        description="OCR language code (ISO 639-3). Use '+' for multiple languages (e.g., 'eng+fra')."
    )
    dpi: int = Field(
        default=300,
        ge=72,
        le=600,
        description="Resolution for OCR processing (72-600 DPI). Higher values improve accuracy but increase processing time."
    )
    enhance_image: bool = Field(
        default=True,
        description="Apply image enhancement (deskew, denoise, contrast adjustment) before OCR."
    )
    detect_orientation: bool = Field(
        default=True,
        description="Automatically detect and correct page orientation."
    )
    output_format: str = Field(
        default="text",
        description="Output format: 'text' (plain text), 'hocr' (HTML with coordinates), 'pdf' (searchable PDF)."
    )

    class Config:
        json_schema_extra = {
            "example": {
                "pages": [1, 2, 3],
                "language": "eng+fra",
                "dpi": 300,
                "enhance_image": True,
                "detect_orientation": True,
                "output_format": "text"
            }
        }


class TextSearchRequest(BaseModel):
    """Request to search text in a document."""

    query: str = Field(description="Text to search for")
    regex: bool = Field(default=False, description="Use regex pattern matching")
    case_sensitive: bool = Field(default=False, description="Case sensitive search")
    whole_word: bool = Field(default=False, description="Match whole words only")
    page_range: Optional[str] = Field(default=None, description="Page range to search (e.g., '1-5,10')")

    class Config:
        json_schema_extra = {
            "example": {
                "query": "chapter",
                "regex": False,
                "case_sensitive": False,
                "whole_word": True,
                "page_range": "1-10"
            }
        }


class TextReplaceRequest(BaseModel):
    """Request to replace text in a document."""

    search: str = Field(description="Text to search for")
    replace: str = Field(description="Replacement text")
    regex: bool = Field(default=False, description="Use regex pattern matching")
    case_sensitive: bool = Field(default=False, description="Case sensitive search")
    whole_word: bool = Field(default=False, description="Match whole words only")
    page_range: Optional[str] = Field(default=None, description="Page range to replace (e.g., '1-5,10')")
    max_replacements: Optional[int] = Field(default=None, ge=1, description="Maximum number of replacements")

    class Config:
        json_schema_extra = {
            "example": {
                "search": "old text",
                "replace": "new text",
                "regex": False,
                "case_sensitive": False,
                "whole_word": False,
                "page_range": None,
                "max_replacements": None
            }
        }


@router.post(
    "/{document_id}/text/search",
    response_model=APIResponse[dict],
    summary="Search text in document",
    response_description="List of all matches found, with page number, position bounds, matched text, and surrounding context",
    description="""Search for text within a PDF document with advanced options including regex pattern matching, case sensitivity, and whole word matching.

This endpoint scans through the text content of a PDF document and returns all occurrences of the search query along with their positions, page numbers, and surrounding context. Useful for finding specific content, validating document contents, or building search functionality.

**Features:**
- Plain text and regex pattern matching
- Case-sensitive or case-insensitive search
- Whole word matching to avoid partial matches
- Page range filtering for targeted searches
- Context extraction around each match

**Performance Notes:**
- Large documents may take longer to search
- Regex patterns with excessive backtracking may timeout
- Use page_range to limit search scope for better performance""",
    responses={
        200: {
            "description": "Search completed successfully. Returns all matches with positions and context.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
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
                }
            }
        },
        400: {"description": "Invalid request parameters (e.g., invalid regex pattern, malformed page range)"},
        404: {"description": "Document not found"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/text/search" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "introduction",
    "regex": false,
    "case_sensitive": false,
    "whole_word": true,
    "page_range": "1-10"
  }'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/text/search"

search_data = {
    "query": "introduction",
    "regex": False,
    "case_sensitive": False,
    "whole_word": True,
    "page_range": "1-10"
}

response = requests.post(
    api_url,
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=search_data
)

result = response.json()
if result["success"]:
    matches = result["data"]["matches"]
    print(f"Found {result['data']['total_matches']} matches")
    for match in matches:
        print(f"Page {match['page_number']}: {match['matched_text']}")
        print(f"  Context: {match['context']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const searchData = {
  query: 'introduction',
  regex: false,
  case_sensitive: false,
  whole_word: true,
  page_range: '1-10'
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/text/search`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(searchData)
  }
);

const result = await response.json();
if (result.success) {
  console.log(`Found ${result.data.total_matches} matches`);
  result.data.matches.forEach(match => {
    console.log(`Page ${match.page_number}: ${match.matched_text}`);
    console.log(`  Context: ${match.context}`);
  });
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/text/search";

$searchData = [
    'query' => 'introduction',
    'regex' => false,
    'case_sensitive' => false,
    'whole_word' => true,
    'page_range' => '1-10'
];

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_API_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode($searchData)
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Found " . $result['data']['total_matches'] . " matches\\n";
    foreach ($result['data']['matches'] as $match) {
        echo "Page " . $match['page_number'] . ": " . $match['matched_text'] . "\\n";
        echo "  Context: " . $match['context'] . "\\n";
    }
}
?>"""
            }
        ]
    },
)
async def search_text(
    document_id: str,
    request: TextSearchRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Search for text in a document."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/text/replace",
    response_model=APIResponse[dict],
    summary="Search and replace text",
    response_description="Number of replacements made, list of affected page numbers, and element IDs of modified text elements",
    description="""Search and replace text within a PDF document with support for regex patterns and advanced matching options.

This endpoint finds all occurrences of the specified search text and replaces them with the replacement text. The operation modifies the document and returns information about the changes made.

**Features:**
- Plain text and regex pattern replacement
- Case-sensitive or case-insensitive matching
- Whole word matching to avoid partial replacements
- Page range filtering to limit replacement scope
- Maximum replacement limit for controlled updates

**Use Cases:**
- Updating company names or branding
- Correcting repeated typos or errors
- Redacting or replacing sensitive information
- Batch updating dates, versions, or references

**Important Notes:**
- This operation modifies the document permanently
- Use max_replacements to limit changes for safety
- Preview changes using the search endpoint first""",
    responses={
        200: {
            "description": "Text replacement completed successfully. Returns count of replacements and affected pages.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "replacements_made": 5,
                            "pages_affected": [1, 3, 5, 12],
                            "replaced_elements": ["txt-001-abc123", "txt-002-def456"]
                        }
                    }
                }
            }
        },
        400: {"description": "Invalid request parameters (e.g., invalid regex pattern, malformed page range)"},
        404: {"description": "Document not found"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/text/replace" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "search": "Acme Corporation",
    "replace": "NewCo Industries",
    "regex": false,
    "case_sensitive": true,
    "whole_word": true,
    "page_range": null,
    "max_replacements": 100
  }'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/text/replace"

replace_data = {
    "search": "Acme Corporation",
    "replace": "NewCo Industries",
    "regex": False,
    "case_sensitive": True,
    "whole_word": True,
    "page_range": None,
    "max_replacements": 100
}

response = requests.post(
    api_url,
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=replace_data
)

result = response.json()
if result["success"]:
    data = result["data"]
    print(f"Made {data['replacements_made']} replacements")
    print(f"Pages affected: {data['pages_affected']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const replaceData = {
  search: 'Acme Corporation',
  replace: 'NewCo Industries',
  regex: false,
  case_sensitive: true,
  whole_word: true,
  page_range: null,
  max_replacements: 100
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/text/replace`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(replaceData)
  }
);

const result = await response.json();
if (result.success) {
  console.log(`Made ${result.data.replacements_made} replacements`);
  console.log(`Pages affected: ${result.data.pages_affected.join(', ')}`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/text/replace";

$replaceData = [
    'search' => 'Acme Corporation',
    'replace' => 'NewCo Industries',
    'regex' => false,
    'case_sensitive' => true,
    'whole_word' => true,
    'page_range' => null,
    'max_replacements' => 100
];

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_API_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode($replaceData)
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Made " . $result['data']['replacements_made'] . " replacements\\n";
    echo "Pages affected: " . implode(', ', $result['data']['pages_affected']) . "\\n";
}
?>"""
            }
        ]
    },
)
async def replace_text(
    document_id: str,
    request: TextReplaceRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Search and replace text in a document."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.get(
    "/{document_id}/text/extract",
    response_model=APIResponse[dict],
    summary="Extract all text from document",
    response_description="Extracted text organized by page, full combined text, total page count, and total character count",
    description="""Extract all text content from a PDF document with optional formatting and layout preservation.

This endpoint extracts text from native PDF text elements (not scanned images - use OCR endpoint for that). Returns text organized by page with optional positional and formatting information.

**Features:**
- Extract text from all or specific pages
- Optionally include font, size, and style information
- Preserve original text layout and positioning
- Get both page-by-page and combined full text

**Output Formats:**
- **pages**: Array of page objects with text and element details
- **full_text**: Combined text from all extracted pages
- **elements**: Individual text elements with bounds (when include_formatting=true)

**Use Cases:**
- Content analysis and indexing
- Text extraction for further processing
- Document conversion workflows
- Accessibility text extraction

**Note:** For scanned PDFs or image-based documents, use the OCR endpoint instead.""",
    responses={
        200: {
            "description": "Text extraction completed successfully. Returns extracted text organized by page.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
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
                }
            }
        },
        400: {"description": "Invalid request parameters (e.g., malformed page range)"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/text/extract?page_range=1-5&include_formatting=true&preserve_layout=true" \\
  -H "Authorization: Bearer $TOKEN"

# Extract all pages without formatting
curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/text/extract" \\
  -H "Authorization: Bearer $TOKEN"

# Extract specific pages
curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/text/extract?page_range=1,3,5-10" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/text/extract"

# Extract text with formatting info
params = {
    "page_range": "1-5",
    "include_formatting": True,
    "preserve_layout": True
}

response = requests.get(
    api_url,
    headers={"Authorization": "Bearer YOUR_API_TOKEN"},
    params=params
)

result = response.json()
if result["success"]:
    data = result["data"]
    print(f"Extracted {data['total_characters']} characters from {data['total_pages']} pages")

    # Access full combined text
    full_text = data["full_text"]

    # Or iterate through pages
    for page in data["pages"]:
        print(f"--- Page {page['page_number']} ---")
        print(page["text"][:200])  # First 200 chars

        # Access individual text elements with positions
        if "elements" in page:
            for elem in page["elements"]:
                print(f"  [{elem['bounds']}] {elem['content'][:50]}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const params = new URLSearchParams({
  page_range: '1-5',
  include_formatting: 'true',
  preserve_layout: 'true'
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/text/extract?${params}`,
  {
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  }
);

const result = await response.json();
if (result.success) {
  const { pages, full_text, total_pages, total_characters } = result.data;

  console.log(`Extracted ${total_characters} characters from ${total_pages} pages`);

  // Access full combined text
  console.log('Full text:', full_text);

  // Or iterate through pages
  pages.forEach(page => {
    console.log(`--- Page ${page.page_number} ---`);
    console.log(page.text.substring(0, 200));
  });
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$params = http_build_query([
    'page_range' => '1-5',
    'include_formatting' => 'true',
    'preserve_layout' => 'true'
]);
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/text/extract?{$params}";

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_API_TOKEN'
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $data = $result['data'];
    echo "Extracted {$data['total_characters']} characters from {$data['total_pages']} pages\\n";

    // Access full combined text
    echo "Full text: " . substr($data['full_text'], 0, 500) . "...\\n";

    // Or iterate through pages
    foreach ($data['pages'] as $page) {
        echo "--- Page {$page['page_number']} ---\\n";
        echo substr($page['text'], 0, 200) . "\\n";
    }
}
?>"""
            }
        ]
    },
)
async def extract_text(
    document_id: str,
    page_range: Optional[str] = Query(default=None, description="Page range filter"),
    include_formatting: bool = Query(default=False, description="Include formatting info"),
    preserve_layout: bool = Query(default=True, description="Preserve text layout"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Extract all text from a document."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.post(
    "/{document_id}/ocr",
    response_model=APIResponse[dict],
    summary="Extract text using OCR",
    response_description="OCR results per page with confidence scores, full extracted text, average confidence, and detected language. Returns 202 with job_id for large documents processed asynchronously",
    description="""Run Optical Character Recognition (OCR) on scanned PDF pages to extract text content.

This endpoint processes image-based or scanned PDF pages using OCR technology to recognize and extract text. Unlike the text extraction endpoint which reads native PDF text, OCR is designed for documents that contain text as images.

**Features:**
- Multi-language OCR support (100+ languages)
- Automatic page orientation detection
- Image enhancement for better accuracy
- Configurable DPI for quality vs. speed tradeoff
- Multiple output formats (plain text, hOCR, searchable PDF)

**Supported Languages:**
Common language codes include:
- `eng` - English
- `fra` - French
- `deu` - German
- `spa` - Spanish
- `ita` - Italian
- `por` - Portuguese
- `jpn` - Japanese
- `chi_sim` - Simplified Chinese
- `chi_tra` - Traditional Chinese
- `ara` - Arabic
- `rus` - Russian

Use `+` to combine languages: `eng+fra` for English and French.

**Processing Notes:**
- OCR is computationally intensive; large documents may be queued
- Higher DPI improves accuracy but increases processing time
- Enable image enhancement for scanned documents with noise or skew

**Best Practices:**
- Use 300 DPI for most documents (good balance of speed and accuracy)
- Use 600 DPI for documents with small text or fine details
- Specify exact languages for better accuracy""",
    responses={
        200: {
            "description": "OCR completed successfully. Returns extracted text with confidence scores.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "pages": [
                                {
                                    "page_number": 1,
                                    "text": "Scanned document text content...",
                                    "confidence": 0.95,
                                    "orientation": 0,
                                    "words": [
                                        {
                                            "text": "Scanned",
                                            "confidence": 0.98,
                                            "bounds": {"x": 100, "y": 50, "width": 80, "height": 20}
                                        }
                                    ]
                                }
                            ],
                            "full_text": "Scanned document text content...",
                            "total_pages_processed": 3,
                            "average_confidence": 0.94,
                            "language_detected": "eng"
                        }
                    }
                }
            }
        },
        202: {
            "description": "OCR job queued for processing. Use the job_id to poll for results.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "job_id": "job_ocr_abc123",
                            "status": "queued",
                            "estimated_time_seconds": 45,
                            "pages_to_process": 10
                        }
                    }
                }
            }
        },
        400: {"description": "Invalid parameters (e.g., unsupported language, invalid DPI, invalid page numbers)"},
        404: {"description": "Document not found"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pages": [1, 2, 3],
    "language": "eng+fra",
    "dpi": 300,
    "enhance_image": true,
    "detect_orientation": true,
    "output_format": "text"
  }'

# OCR all pages with default settings
curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"language": "eng"}'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests
import time

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr"

ocr_data = {
    "pages": [1, 2, 3],
    "language": "eng+fra",
    "dpi": 300,
    "enhance_image": True,
    "detect_orientation": True,
    "output_format": "text"
}

response = requests.post(
    api_url,
    headers={
        "Authorization": "Bearer YOUR_API_TOKEN",
        "Content-Type": "application/json"
    },
    json=ocr_data
)

result = response.json()

# Handle async processing (202 response)
if response.status_code == 202:
    job_id = result["data"]["job_id"]
    print(f"OCR job queued: {job_id}")

    # Poll for results
    while True:
        status_response = requests.get(
            f"https://api.giga-pdf.com/api/v1/jobs/{job_id}",
            headers={"Authorization": "Bearer YOUR_API_TOKEN"}
        )
        status = status_response.json()
        if status["data"]["status"] == "completed":
            result = status["data"]["result"]
            break
        time.sleep(2)

# Process results
if result["success"]:
    data = result["data"]
    print(f"OCR completed with {data['average_confidence']:.0%} confidence")
    print(f"Detected language: {data['language_detected']}")
    print(f"Extracted text: {data['full_text'][:500]}...")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const ocrData = {
  pages: [1, 2, 3],
  language: 'eng+fra',
  dpi: 300,
  enhance_image: true,
  detect_orientation: true,
  output_format: 'text'
};

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/ocr`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(ocrData)
  }
);

let result = await response.json();

// Handle async processing (202 response)
if (response.status === 202) {
  const jobId = result.data.job_id;
  console.log(`OCR job queued: ${jobId}`);

  // Poll for results
  while (true) {
    const statusResponse = await fetch(
      `https://api.giga-pdf.com/api/v1/jobs/${jobId}`,
      { headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' } }
    );
    const status = await statusResponse.json();
    if (status.data.status === 'completed') {
      result = status.data.result;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

if (result.success) {
  console.log(`OCR completed with ${(result.data.average_confidence * 100).toFixed(0)}% confidence`);
  console.log(`Extracted text: ${result.data.full_text.substring(0, 500)}...`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/ocr";

$ocrData = [
    'pages' => [1, 2, 3],
    'language' => 'eng+fra',
    'dpi' => 300,
    'enhance_image' => true,
    'detect_orientation' => true,
    'output_format' => 'text'
];

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_API_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode($ocrData)
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);

// Handle async processing (202 response)
if ($httpCode === 202) {
    $jobId = $result['data']['job_id'];
    echo "OCR job queued: {$jobId}\\n";

    // Poll for results
    while (true) {
        $ch = curl_init("https://api.giga-pdf.com/api/v1/jobs/{$jobId}");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer YOUR_API_TOKEN']
        ]);
        $statusResponse = curl_exec($ch);
        curl_close($ch);

        $status = json_decode($statusResponse, true);
        if ($status['data']['status'] === 'completed') {
            $result = $status['data']['result'];
            break;
        }
        sleep(2);
    }
}

if ($result['success']) {
    $data = $result['data'];
    echo "OCR completed with " . round($data['average_confidence'] * 100) . "% confidence\\n";
    echo "Extracted text: " . substr($data['full_text'], 0, 500) . "...\\n";
}
?>"""
            }
        ]
    },
)
async def ocr_document(
    document_id: str,
    request: OCRRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Run OCR on a document to extract text from scanned pages."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.get(
    "/{document_id}/ocr/status",
    response_model=APIResponse[dict],
    summary="Get OCR job status",
    response_description="Current job state (queued/processing/completed/failed), progress percentage, pages processed, estimated time remaining, and OCR results when completed",
    description="""Check the status of an OCR processing job.

For large documents, OCR operations are processed asynchronously. This endpoint allows you to poll for the status of a running OCR job and retrieve results when complete.

**Job States:**
- `queued` - Job is waiting to be processed
- `processing` - OCR is currently running
- `completed` - OCR finished successfully, results available
- `failed` - OCR failed, error details provided

**Response Fields:**
- `status` - Current job state
- `progress` - Percentage complete (0-100)
- `pages_processed` - Number of pages completed
- `estimated_time_remaining` - Seconds until completion (estimate)
- `result` - OCR results (only when status is 'completed')""",
    responses={
        200: {
            "description": "Job status retrieved successfully.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "job_id": "job_ocr_abc123",
                            "status": "processing",
                            "progress": 45,
                            "pages_processed": 5,
                            "total_pages": 11,
                            "estimated_time_remaining": 30,
                            "started_at": "2024-01-15T10:30:00Z"
                        }
                    }
                }
            }
        },
        404: {"description": "Document or OCR job not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr/status?job_id=job_ocr_abc123" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests
import time

document_id = "doc_abc123"
job_id = "job_ocr_abc123"

def poll_ocr_status(document_id, job_id, max_wait=300):
    \"\"\"Poll OCR status until complete or timeout.\"\"\"
    api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr/status"
    start_time = time.time()

    while time.time() - start_time < max_wait:
        response = requests.get(
            api_url,
            headers={"Authorization": "Bearer YOUR_API_TOKEN"},
            params={"job_id": job_id}
        )

        result = response.json()
        if not result["success"]:
            raise Exception(f"Error: {result.get('error')}")

        status = result["data"]["status"]
        progress = result["data"].get("progress", 0)

        print(f"Status: {status} - Progress: {progress}%")

        if status == "completed":
            return result["data"]["result"]
        elif status == "failed":
            raise Exception(f"OCR failed: {result['data'].get('error')}")

        time.sleep(2)

    raise TimeoutError("OCR job timed out")

# Usage
try:
    ocr_result = poll_ocr_status(document_id, job_id)
    print(f"OCR complete! Extracted {len(ocr_result['full_text'])} characters")
except Exception as e:
    print(f"OCR failed: {e}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';
const jobId = 'job_ocr_abc123';

async function pollOcrStatus(documentId, jobId, maxWait = 300000) {
  const apiUrl = `https://api.giga-pdf.com/api/v1/documents/${documentId}/ocr/status`;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const response = await fetch(
      `${apiUrl}?job_id=${jobId}`,
      {
        headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
      }
    );

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Error: ${result.error}`);
    }

    const { status, progress } = result.data;
    console.log(`Status: ${status} - Progress: ${progress}%`);

    if (status === 'completed') {
      return result.data.result;
    } else if (status === 'failed') {
      throw new Error(`OCR failed: ${result.data.error}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('OCR job timed out');
}

// Usage
try {
  const ocrResult = await pollOcrStatus(documentId, jobId);
  console.log(`OCR complete! Extracted ${ocrResult.full_text.length} characters`);
} catch (error) {
  console.error(`OCR failed: ${error.message}`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$jobId = 'job_ocr_abc123';

function pollOcrStatus($documentId, $jobId, $maxWait = 300) {
    $apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/ocr/status";
    $startTime = time();

    while (time() - $startTime < $maxWait) {
        $ch = curl_init($apiUrl . "?job_id=" . urlencode($jobId));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer YOUR_API_TOKEN']
        ]);

        $response = curl_exec($ch);
        curl_close($ch);

        $result = json_decode($response, true);
        if (!$result['success']) {
            throw new Exception("Error: " . $result['error']);
        }

        $status = $result['data']['status'];
        $progress = $result['data']['progress'] ?? 0;

        echo "Status: {$status} - Progress: {$progress}%\\n";

        if ($status === 'completed') {
            return $result['data']['result'];
        } elseif ($status === 'failed') {
            throw new Exception("OCR failed: " . $result['data']['error']);
        }

        sleep(2);
    }

    throw new Exception("OCR job timed out");
}

// Usage
try {
    $ocrResult = pollOcrStatus($documentId, $jobId);
    echo "OCR complete! Extracted " . strlen($ocrResult['full_text']) . " characters\\n";
} catch (Exception $e) {
    echo "OCR failed: " . $e->getMessage() . "\\n";
}
?>"""
            }
        ]
    },
)
async def get_ocr_status(
    document_id: str,
    job_id: str = Query(description="OCR job ID returned from the OCR endpoint"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get the status of an OCR processing job."""
    # TODO: implement — currently returns 501
    raise HTTPException(
        status_code=501,
        detail="Not implemented. This endpoint is a stub — use the TypeScript engine via /api/pdf/* routes for now.",
    )


@router.get(
    "/{document_id}/ocr/languages",
    response_model=APIResponse[dict],
    summary="List available OCR languages",
    response_description="List of supported OCR language codes with names and scripts, total language count, and languages recommended for the document",
    description="""Get a list of all available OCR languages supported for a document.

This endpoint returns all language codes that can be used with the OCR endpoint. Languages are identified by their ISO 639-3 three-letter codes.

**Common Languages:**
| Code | Language |
|------|----------|
| eng | English |
| fra | French |
| deu | German |
| spa | Spanish |
| ita | Italian |
| por | Portuguese |
| nld | Dutch |
| pol | Polish |
| rus | Russian |
| jpn | Japanese |
| kor | Korean |
| chi_sim | Simplified Chinese |
| chi_tra | Traditional Chinese |
| ara | Arabic |
| hin | Hindi |

**Multi-language OCR:**
Combine multiple languages with `+` separator: `eng+fra+deu`

Note: Using fewer languages improves OCR speed and accuracy.""",
    responses={
        200: {
            "description": "List of available OCR languages.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "languages": [
                                {"code": "eng", "name": "English", "script": "Latin"},
                                {"code": "fra", "name": "French", "script": "Latin"},
                                {"code": "deu", "name": "German", "script": "Latin"},
                                {"code": "spa", "name": "Spanish", "script": "Latin"},
                                {"code": "jpn", "name": "Japanese", "script": "Japanese"},
                                {"code": "chi_sim", "name": "Chinese (Simplified)", "script": "Han (Simplified)"},
                                {"code": "ara", "name": "Arabic", "script": "Arabic"}
                            ],
                            "total_languages": 100,
                            "recommended_for_document": ["eng", "fra"]
                        }
                    }
                }
            }
        },
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr/languages" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "doc_abc123"
api_url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/ocr/languages"

response = requests.get(
    api_url,
    headers={"Authorization": "Bearer YOUR_API_TOKEN"}
)

result = response.json()
if result["success"]:
    languages = result["data"]["languages"]
    print(f"Available languages: {len(languages)}")

    # Display recommended languages
    recommended = result["data"].get("recommended_for_document", [])
    if recommended:
        print(f"Recommended for this document: {', '.join(recommended)}")

    # List all languages by script
    scripts = {}
    for lang in languages:
        script = lang["script"]
        if script not in scripts:
            scripts[script] = []
        scripts[script].append(lang["name"])

    for script, names in scripts.items():
        print(f"\\n{script}: {', '.join(names[:5])}{'...' if len(names) > 5 else ''}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = 'doc_abc123';

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/ocr/languages`,
  {
    headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
  }
);

const result = await response.json();
if (result.success) {
  const { languages, recommended_for_document } = result.data;
  console.log(`Available languages: ${languages.length}`);

  if (recommended_for_document?.length) {
    console.log(`Recommended: ${recommended_for_document.join(', ')}`);
  }

  // Group by script
  const byScript = languages.reduce((acc, lang) => {
    if (!acc[lang.script]) acc[lang.script] = [];
    acc[lang.script].push(lang.name);
    return acc;
  }, {});

  Object.entries(byScript).forEach(([script, names]) => {
    console.log(`${script}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}`);
  });
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = 'doc_abc123';
$apiUrl = "https://api.giga-pdf.com/api/v1/documents/{$documentId}/ocr/languages";

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer YOUR_API_TOKEN']
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $languages = $result['data']['languages'];
    echo "Available languages: " . count($languages) . "\\n";

    $recommended = $result['data']['recommended_for_document'] ?? [];
    if (!empty($recommended)) {
        echo "Recommended: " . implode(', ', $recommended) . "\\n";
    }

    // Group by script
    $byScript = [];
    foreach ($languages as $lang) {
        $script = $lang['script'];
        if (!isset($byScript[$script])) {
            $byScript[$script] = [];
        }
        $byScript[$script][] = $lang['name'];
    }

    foreach ($byScript as $script => $names) {
        $displayNames = array_slice($names, 0, 5);
        $suffix = count($names) > 5 ? '...' : '';
        echo "{$script}: " . implode(', ', $displayNames) . $suffix . "\\n";
    }
}
?>"""
            }
        ]
    },
)
async def get_ocr_languages(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get available OCR languages for a document."""
    start_time = time.time()

    # Common OCR languages - in production, this would come from OCR engine
    languages = [
        {"code": "eng", "name": "English", "script": "Latin"},
        {"code": "fra", "name": "French", "script": "Latin"},
        {"code": "deu", "name": "German", "script": "Latin"},
        {"code": "spa", "name": "Spanish", "script": "Latin"},
        {"code": "ita", "name": "Italian", "script": "Latin"},
        {"code": "por", "name": "Portuguese", "script": "Latin"},
        {"code": "nld", "name": "Dutch", "script": "Latin"},
        {"code": "pol", "name": "Polish", "script": "Latin"},
        {"code": "rus", "name": "Russian", "script": "Cyrillic"},
        {"code": "jpn", "name": "Japanese", "script": "Japanese"},
        {"code": "kor", "name": "Korean", "script": "Korean"},
        {"code": "chi_sim", "name": "Chinese (Simplified)", "script": "Han (Simplified)"},
        {"code": "chi_tra", "name": "Chinese (Traditional)", "script": "Han (Traditional)"},
        {"code": "ara", "name": "Arabic", "script": "Arabic"},
        {"code": "hin", "name": "Hindi", "script": "Devanagari"},
    ]

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "languages": languages,
            "total_languages": len(languages),
            "recommended_for_document": ["eng", "fra"],
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
