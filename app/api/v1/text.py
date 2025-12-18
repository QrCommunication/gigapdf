"""
Text operations endpoints.

Handles text search, replacement, and extraction from PDF documents.
"""

import time
from typing import Optional

from fastapi import APIRouter, Query

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc
from pydantic import BaseModel, Field

router = APIRouter()


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
    description="""
Search for text within a PDF document with optional regex support.

## Request Body
```json
{
  "query": "search term",
  "regex": false,
  "case_sensitive": false,
  "whole_word": true,
  "page_range": "1-5,10"
}
```

## Query Parameters
- **query**: Text or regex pattern to search for
- **regex**: Enable regex pattern matching (default: false)
- **case_sensitive**: Case sensitive search (default: false)
- **whole_word**: Match whole words only (default: false)
- **page_range**: Optional page range filter (e.g., "1-5,10,15-20")

## Response
Returns all matches with page number, position, and context.

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "page_number": 1,
        "element_id": "uuid",
        "bounds": {"x": 100, "y": 200, "width": 50, "height": 20},
        "matched_text": "search term",
        "context": "...surrounding text with search term in it..."
      }
    ],
    "total_matches": 15,
    "pages_searched": 10
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/text/search" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "introduction",
    "case_sensitive": false,
    "whole_word": true
  }'
```

## Example (Python)
```python
import requests

search_data = {
    "query": "introduction",
    "case_sensitive": False,
    "whole_word": True,
    "page_range": "1-10"
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/text/search",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=search_data
)
matches = response.json()["data"]["matches"]
print(f"Found {len(matches)} matches")
```

## Example (JavaScript)
```javascript
const searchData = {
  query: 'introduction',
  caseSensitive: false,
  wholeWord: true,
  pageRange: '1-10'
};

const response = await fetch(`/api/v1/documents/${documentId}/text/search`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(searchData)
});
const result = await response.json();
console.log(`Found ${result.data.total_matches} matches`);
```

## Example (PHP)
```php
$searchData = [
    'query' => 'introduction',
    'case_sensitive' => false,
    'whole_word' => true,
    'page_range' => '1-10'
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/text/search",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $searchData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Found " . $result['data']['total_matches'] . " matches";
```
""",
)
async def search_text(
    document_id: str,
    request: TextSearchRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Search for text in a document."""
    start_time = time.time()

    # TODO: Implement text search logic using document service
    # This is a placeholder implementation
    matches = []

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "matches": matches,
            "total_matches": len(matches),
            "pages_searched": 0,
            "query": request.query,
            "settings": {
                "regex": request.regex,
                "case_sensitive": request.case_sensitive,
                "whole_word": request.whole_word,
                "page_range": request.page_range,
            },
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/text/replace",
    response_model=APIResponse[dict],
    summary="Search and replace text",
    description="""
Search and replace text within a PDF document.

## Request Body
```json
{
  "search": "old text",
  "replace": "new text",
  "regex": false,
  "case_sensitive": false,
  "whole_word": false,
  "page_range": null,
  "max_replacements": null
}
```

## Parameters
- **search**: Text or regex pattern to search for
- **replace**: Replacement text
- **regex**: Enable regex pattern matching (default: false)
- **case_sensitive**: Case sensitive search (default: false)
- **whole_word**: Match whole words only (default: false)
- **page_range**: Optional page range filter
- **max_replacements**: Maximum number of replacements (null = unlimited)

## Response
Returns the number of replacements made and affected pages.

```json
{
  "success": true,
  "data": {
    "replacements_made": 5,
    "pages_affected": [1, 3, 5],
    "replaced_elements": ["uuid1", "uuid2"]
  }
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/text/replace" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "search": "old company name",
    "replace": "new company name",
    "case_sensitive": true
  }'
```

## Example (Python)
```python
import requests

replace_data = {
    "search": "old company name",
    "replace": "new company name",
    "case_sensitive": True,
    "max_replacements": 10
}

response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/text/replace",
    headers={"Authorization": "Bearer <token>", "Content-Type": "application/json"},
    json=replace_data
)
result = response.json()["data"]
print(f"Made {result['replacements_made']} replacements on {len(result['pages_affected'])} pages")
```

## Example (JavaScript)
```javascript
const replaceData = {
  search: 'old company name',
  replace: 'new company name',
  caseSensitive: true,
  maxReplacements: 10
};

const response = await fetch(`/api/v1/documents/${documentId}/text/replace`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(replaceData)
});
const result = await response.json();
console.log(`Made ${result.data.replacements_made} replacements`);
```

## Example (PHP)
```php
$replaceData = [
    'search' => 'old company name',
    'replace' => 'new company name',
    'case_sensitive' => true,
    'max_replacements' => 10
];

$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/text/replace",
    [
        'headers' => ['Authorization' => 'Bearer <token>', 'Content-Type' => 'application/json'],
        'json' => $replaceData
    ]
);
$result = json_decode($response->getBody(), true);
echo "Made " . $result['data']['replacements_made'] . " replacements";
```
""",
)
async def replace_text(
    document_id: str,
    request: TextReplaceRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Search and replace text in a document."""
    start_time = time.time()

    # TODO: Implement text replace logic using document service
    # This is a placeholder implementation
    replacements_made = 0
    pages_affected = []
    replaced_elements = []

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "replacements_made": replacements_made,
            "pages_affected": pages_affected,
            "replaced_elements": replaced_elements,
            "settings": {
                "search": request.search,
                "replace": request.replace,
                "regex": request.regex,
                "case_sensitive": request.case_sensitive,
                "whole_word": request.whole_word,
                "page_range": request.page_range,
                "max_replacements": request.max_replacements,
            },
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}/text/extract",
    response_model=APIResponse[dict],
    summary="Extract all text from document",
    description="""
Extract all text content from a PDF document.

## Query Parameters
- **page_range**: Optional page range filter (e.g., "1-5,10,15-20")
- **include_formatting**: Include text formatting information (default: false)
- **preserve_layout**: Preserve text layout/positioning (default: true)

## Response
Returns extracted text organized by page.

```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "page_number": 1,
        "text": "Full text content from page 1...",
        "elements": [
          {
            "element_id": "uuid",
            "content": "text content",
            "bounds": {"x": 100, "y": 200, "width": 200, "height": 50},
            "style": {...}
          }
        ]
      }
    ],
    "full_text": "Combined text from all pages...",
    "total_pages": 10,
    "total_characters": 5432
  }
}
```

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/text/extract?page_range=1-5" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/text/extract",
    headers={"Authorization": "Bearer <token>"},
    params={"page_range": "1-5", "include_formatting": True}
)
text_data = response.json()["data"]
print(f"Extracted {text_data['total_characters']} characters from {text_data['total_pages']} pages")
```

## Example (JavaScript)
```javascript
const params = new URLSearchParams({
  pageRange: '1-5',
  includeFormatting: 'true'
});

const response = await fetch(`/api/v1/documents/${documentId}/text/extract?${params}`, {
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
console.log(result.data.full_text);
```

## Example (PHP)
```php
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/text/extract",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['page_range' => '1-5', 'include_formatting' => true]
    ]
);
$result = json_decode($response->getBody(), true);
echo $result['data']['full_text'];
```
""",
)
async def extract_text(
    document_id: str,
    page_range: Optional[str] = Query(default=None, description="Page range filter"),
    include_formatting: bool = Query(default=False, description="Include formatting info"),
    preserve_layout: bool = Query(default=True, description="Preserve text layout"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Extract all text from a document."""
    start_time = time.time()

    # TODO: Implement text extraction logic using document service
    # This is a placeholder implementation
    pages_data = []
    full_text = ""

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "pages": pages_data,
            "full_text": full_text,
            "total_pages": len(pages_data),
            "total_characters": len(full_text),
            "settings": {
                "page_range": page_range,
                "include_formatting": include_formatting,
                "preserve_layout": preserve_layout,
            },
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
