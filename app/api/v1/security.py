"""
PDF security endpoints.

Handles PDF encryption, decryption, and permission management via pikepdf.
Encryption is applied inline using pikepdf (AES-256 / AES-128 / RC4-128) and
the resulting bytes are persisted back into the document session so that
subsequent save / download operations return the actually-encrypted file.
"""

import io
import time

import pikepdf
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

router = APIRouter()


class EncryptDocumentRequest(BaseModel):
    """Request to encrypt a PDF document."""

    user_password: str | None = Field(
        default=None,
        description="Password required to open the document (user password)",
    )
    owner_password: str | None = Field(
        default=None,
        description="Password required to change permissions (owner password)",
    )
    allow_printing: bool = Field(
        default=True,
        description="Allow printing the document",
    )
    allow_copying: bool = Field(
        default=True,
        description="Allow copying text and graphics",
    )
    allow_annotation: bool = Field(
        default=True,
        description="Allow adding or modifying annotations",
    )
    allow_form_filling: bool = Field(
        default=True,
        description="Allow filling form fields",
    )
    allow_modification: bool = Field(
        default=False,
        description="Allow modifying the document",
    )
    allow_assembly: bool = Field(
        default=False,
        description="Allow inserting, deleting, and rotating pages",
    )
    encryption_algorithm: str = Field(
        default="AES-256",
        description="Encryption algorithm (RC4-128, AES-128, AES-256)",
    )


class DecryptDocumentRequest(BaseModel):
    """Request to decrypt a PDF document."""

    password: str = Field(
        description="Password to decrypt the document",
    )


@router.post(
    "/{document_id}/security/encrypt",
    response_model=APIResponse[dict],
    summary="Encrypt PDF document",
    response_description="Encryption applied — contains the document ID, encryption status, algorithm used, and the full set of applied permission flags",
    description="""Add password protection and set permissions for a PDF document.

You can set two types of passwords:
- **User password**: Required to open and view the document
- **Owner password**: Required to change security settings and permissions

You can also control various permissions:
- Printing
- Copying text and graphics
- Adding annotations
- Filling form fields
- Modifying content
- Assembling pages

Supported encryption algorithms:
- **RC4-128**: Legacy encryption (not recommended for sensitive documents)
- **AES-128**: Strong encryption suitable for most use cases
- **AES-256**: Maximum security encryption (recommended)
""",
    responses={
        200: {
            "description": "Document encrypted successfully. Returns the document ID, encryption status, algorithm used, and applied permissions.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "encrypted": True,
                            "algorithm": "AES-256",
                            "permissions": {
                                "printing": True,
                                "copying": False,
                                "annotation": True,
                                "form_filling": True,
                                "modification": False,
                                "assembly": False,
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid encryption parameters. This can occur when no password is provided, or an unsupported encryption algorithm is specified."},
        401: {"description": "Unauthorized. Missing or invalid authentication token."},
        404: {"description": "Document not found. The specified document_id does not exist or the session has expired."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/security/encrypt" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_password": "secret123",
    "owner_password": "admin456",
    "allow_printing": true,
    "allow_copying": false,
    "allow_annotation": true,
    "allow_form_filling": true,
    "allow_modification": false,
    "allow_assembly": false,
    "encryption_algorithm": "AES-256"
  }'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"
token = "your_api_token"

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/security/encrypt",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={
        "user_password": "secret123",
        "owner_password": "admin456",
        "allow_printing": True,
        "allow_copying": False,
        "allow_annotation": True,
        "allow_form_filling": True,
        "allow_modification": False,
        "allow_assembly": False,
        "encryption_algorithm": "AES-256"
    }
)

result = response.json()
print(f"Encrypted: {result['data']['encrypted']}")
print(f"Algorithm: {result['data']['algorithm']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = "550e8400-e29b-41d4-a716-446655440000";
const token = "your_api_token";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/security/encrypt`,
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user_password: "secret123",
      owner_password: "admin456",
      allow_printing: true,
      allow_copying: false,
      allow_annotation: true,
      allow_form_filling: true,
      allow_modification: false,
      allow_assembly: false,
      encryption_algorithm: "AES-256"
    })
  }
);

const result = await response.json();
console.log(`Encrypted: ${result.data.encrypted}`);
console.log(`Algorithm: ${result.data.algorithm}`);"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = "550e8400-e29b-41d4-a716-446655440000";
$token = "your_api_token";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/security/encrypt",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "user_password" => "secret123",
        "owner_password" => "admin456",
        "allow_printing" => true,
        "allow_copying" => false,
        "allow_annotation" => true,
        "allow_form_filling" => true,
        "allow_modification" => false,
        "allow_assembly" => false,
        "encryption_algorithm" => "AES-256"
    ])
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
echo "Encrypted: " . ($result["data"]["encrypted"] ? "Yes" : "No") . "\\n";
echo "Algorithm: " . $result["data"]["algorithm"] . "\\n";
?>"""
            }
        ]
    },
)
async def encrypt_document(
    document_id: str,
    request: EncryptDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Apply real AES-256 / AES-128 / RC4-128 encryption via pikepdf and persist bytes."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = await document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # Validate: at least one password is required by the PDF spec
    if not request.user_password and not request.owner_password:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("At least one password (user or owner) is required")

    # Validate encryption algorithm
    valid_algorithms = ("RC4-128", "AES-128", "AES-256")
    if request.encryption_algorithm not in valid_algorithms:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(
            f"Invalid encryption algorithm. Must be one of: {', '.join(valid_algorithms)}"
        )

    # Map algorithm label to pikepdf R value (ISO 32000-1 §7.6.3.3)
    # R=4 → AES-128 / RC4-128 (PDF 1.4–1.5), R=6 → AES-256 (PDF 1.7 ext3)
    _algo_to_R = {
        "RC4-128": 4,
        "AES-128": 4,
        "AES-256": 6,
    }
    R = _algo_to_R[request.encryption_algorithm]
    # R=4 supports both RC4-128 and AES-128; pikepdf uses AES when R=4 and aes=True
    use_aes = request.encryption_algorithm != "RC4-128"

    # Build pikepdf.Permissions from request flags
    # pikepdf field names follow the PDF spec permission names
    perms = pikepdf.Permissions(
        print_lowres=request.allow_printing,
        print_highres=request.allow_printing,
        modify_other=request.allow_modification,
        extract=request.allow_copying,
        accessibility=request.allow_copying,  # linked to extract in PDF spec
        modify_annotation=request.allow_annotation,
        modify_form=request.allow_form_filling,
        modify_assembly=request.allow_assembly,
    )

    enc = pikepdf.Encryption(
        user=request.user_password or "",
        owner=request.owner_password or request.user_password or "",
        R=R,
        allow=perms,
        aes=use_aes,
        metadata=True,  # encrypt XMP metadata stream as well
    )

    # Get current PDF bytes from session
    pdf_bytes = session.pdf_doc.tobytes()

    try:
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            output = io.BytesIO()
            pdf.save(output, encryption=enc)
            encrypted_bytes = output.getvalue()
    except pikepdf.PdfError as exc:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(f"PDF encryption failed: {exc}") from exc

    # Persist encrypted bytes back into the document session so that
    # tobytes(), Redis persistence, and download all return the ciphertext.
    # This mirrors the pattern used by LegacyDocumentProxy.select().
    from app.core.pdf_engine import pdf_engine
    pdf_engine._documents[document_id] = encrypted_bytes
    session.pdf_doc._pdf_bytes = encrypted_bytes
    session.pdf_doc.is_encrypted = True

    # Keep _pdf_bytes on session in sync for direct access paths
    if hasattr(session, "_pdf_bytes"):
        session._pdf_bytes = encrypted_bytes

    # Add history entry
    document_sessions.push_history(
        document_id,
        f"Encrypted document with {request.encryption_algorithm}",
        affected_pages=None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "encrypted": True,
            "algorithm": request.encryption_algorithm,
            "permissions": {
                "printing": request.allow_printing,
                "copying": request.allow_copying,
                "annotation": request.allow_annotation,
                "form_filling": request.allow_form_filling,
                "modification": request.allow_modification,
                "assembly": request.allow_assembly,
            },
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/{document_id}/security/decrypt",
    response_model=APIResponse[dict],
    summary="Decrypt PDF document",
    response_description="Decryption successful — confirms the document is now accessible without password protection",
    description="""Remove password protection from a PDF document.

This endpoint removes all encryption and password protection from a PDF document, making it freely accessible without any credentials.

**Requirements:**
- The document must be currently encrypted
- You must provide either the owner password or user password with modification permissions

**Important Notes:**
- Once decrypted, the document will have no password protection
- All permission restrictions will be removed
- This action can be reversed by encrypting the document again
""",
    responses={
        200: {
            "description": "Document decrypted successfully. The document is now accessible without password protection.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "decrypted": True,
                            "message": "Document decrypted successfully",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid operation. The document is not encrypted or the provided password is incorrect."},
        401: {"description": "Unauthorized. Missing or invalid authentication token."},
        404: {"description": "Document not found. The specified document_id does not exist or the session has expired."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/security/decrypt" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "password": "secret123"
  }'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"
token = "your_api_token"

response = requests.post(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/security/decrypt",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    json={
        "password": "secret123"
    }
)

result = response.json()
if result["success"]:
    print("Document decrypted successfully!")
    print(f"Document ID: {result['data']['document_id']}")
else:
    print(f"Error: {result.get('error', 'Unknown error')}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = "550e8400-e29b-41d4-a716-446655440000";
const token = "your_api_token";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/security/decrypt`,
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      password: "secret123"
    })
  }
);

const result = await response.json();
if (result.success) {
  console.log("Document decrypted successfully!");
  console.log(`Document ID: ${result.data.document_id}`);
} else {
  console.error(`Error: ${result.error || "Unknown error"}`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = "550e8400-e29b-41d4-a716-446655440000";
$token = "your_api_token";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/security/decrypt",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "password" => "secret123"
    ])
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);
if ($result["success"]) {
    echo "Document decrypted successfully!\\n";
    echo "Document ID: " . $result["data"]["document_id"] . "\\n";
} else {
    echo "Error: " . ($result["error"] ?? "Unknown error") . "\\n";
}
?>"""
            }
        ]
    },
)
async def decrypt_document(
    document_id: str,
    request: DecryptDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Remove password protection via pikepdf and persist the plaintext bytes."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = await document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # Check if document is actually encrypted
    if not session.pdf_doc.is_encrypted:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("Document is not encrypted")

    # Authenticate with pikepdf and save without encryption in one pass
    pdf_bytes = session.pdf_doc.tobytes()
    try:
        with pikepdf.open(io.BytesIO(pdf_bytes), password=request.password) as pdf:
            output = io.BytesIO()
            # Saving without an `encryption=` argument strips all password protection
            pdf.save(output)
            decrypted_bytes = output.getvalue()
    except pikepdf.PasswordError:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError("Invalid password")
    except pikepdf.PdfError as exc:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(f"PDF decryption failed: {exc}") from exc

    # Persist plaintext bytes back into the session (mirrors encrypt_document pattern)
    from app.core.pdf_engine import pdf_engine
    pdf_engine._documents[document_id] = decrypted_bytes
    session.pdf_doc._pdf_bytes = decrypted_bytes
    session.pdf_doc.is_encrypted = False

    if hasattr(session, "_pdf_bytes"):
        session._pdf_bytes = decrypted_bytes

    # Add history entry
    document_sessions.push_history(
        document_id,
        "Removed document encryption",
        affected_pages=None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "decrypted": True,
            "message": "Document decrypted successfully",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}/security/permissions",
    response_model=APIResponse[dict],
    summary="Get document permissions",
    response_description="Current security settings — contains encryption status, algorithm (if encrypted), and the complete map of permission flags",
    description="""Retrieve the current security permissions and encryption status for a PDF document.

This endpoint returns comprehensive information about the document's security settings:

**Encryption Status:**
- Whether the document is encrypted
- The encryption algorithm used (if encrypted)

**Permission Flags:**
- **printing**: Can the document be printed?
- **copying**: Can text and graphics be copied?
- **annotation**: Can annotations be added or modified?
- **form_filling**: Can form fields be filled?
- **modification**: Can the document content be modified?
- **assembly**: Can pages be inserted, deleted, or rotated?

**Note:** For unencrypted documents, all permissions return `true` as there are no restrictions.
""",
    responses={
        200: {
            "description": "Permissions retrieved successfully. Returns the encryption status and all permission flags.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "is_encrypted": True,
                            "encryption_algorithm": "AES-256",
                            "permissions": {
                                "printing": True,
                                "copying": False,
                                "annotation": True,
                                "form_filling": True,
                                "modification": False,
                                "assembly": False,
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        401: {"description": "Unauthorized. Missing or invalid authentication token."},
        404: {"description": "Document not found. The specified document_id does not exist or the session has expired."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/security/permissions" \\
  -H "Authorization: Bearer $TOKEN"
"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

document_id = "550e8400-e29b-41d4-a716-446655440000"
token = "your_api_token"

response = requests.get(
    f"https://api.giga-pdf.com/api/v1/documents/{document_id}/security/permissions",
    headers={
        "Authorization": f"Bearer {token}"
    }
)

result = response.json()
data = result["data"]

print(f"Document ID: {data['document_id']}")
print(f"Encrypted: {data['is_encrypted']}")
if data["is_encrypted"]:
    print(f"Algorithm: {data['encryption_algorithm']}")

print("\\nPermissions:")
for perm, allowed in data["permissions"].items():
    status = "Allowed" if allowed else "Denied"
    print(f"  {perm}: {status}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """const documentId = "550e8400-e29b-41d4-a716-446655440000";
const token = "your_api_token";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/documents/${documentId}/security/permissions`,
  {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  }
);

const result = await response.json();
const data = result.data;

console.log(`Document ID: ${data.document_id}`);
console.log(`Encrypted: ${data.is_encrypted}`);
if (data.is_encrypted) {
  console.log(`Algorithm: ${data.encryption_algorithm}`);
}

console.log("\\nPermissions:");
Object.entries(data.permissions).forEach(([perm, allowed]) => {
  const status = allowed ? "Allowed" : "Denied";
  console.log(`  ${perm}: ${status}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
$documentId = "550e8400-e29b-41d4-a716-446655440000";
$token = "your_api_token";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/security/permissions",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$token}"
    ]
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$data = $result["data"];

echo "Document ID: " . $data["document_id"] . "\\n";
echo "Encrypted: " . ($data["is_encrypted"] ? "Yes" : "No") . "\\n";
if ($data["is_encrypted"]) {
    echo "Algorithm: " . $data["encryption_algorithm"] . "\\n";
}

echo "\\nPermissions:\\n";
foreach ($data["permissions"] as $perm => $allowed) {
    $status = $allowed ? "Allowed" : "Denied";
    echo "  {$perm}: {$status}\\n";
}
?>"""
            }
        ]
    },
)
async def get_permissions(
    document_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get current security permissions."""
    start_time = time.time()

    from app.repositories.document_repo import document_sessions

    session = await document_sessions.get_session(document_id)
    if not session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # PDF spec permission bit positions (ISO 32000-1 §7.6.3.3)
    PDF_PERM_PRINT = 4
    PDF_PERM_MODIFY = 8
    PDF_PERM_COPY = 16
    PDF_PERM_ANNOTATE = 32
    PDF_PERM_FORM = 256
    PDF_PERM_ASSEMBLE = 1024

    pdf_doc = session.pdf_doc

    # Get encryption info
    is_encrypted = pdf_doc.is_encrypted
    encryption_algorithm = None

    if is_encrypted:
        # Try to determine encryption algorithm from stored metadata
        metadata = pdf_doc.metadata
        encryption_algorithm = metadata.get("encryption", "Unknown")

    # Permissions bitmask — LegacyDocumentProxy always returns -1 (all allowed)
    # for unencrypted docs; for encrypted docs params are stored in session.
    perm = pdf_doc.permissions if is_encrypted else -1

    permissions = {
        "printing": bool(perm & PDF_PERM_PRINT) if is_encrypted else True,
        "copying": bool(perm & PDF_PERM_COPY) if is_encrypted else True,
        "annotation": bool(perm & PDF_PERM_ANNOTATE) if is_encrypted else True,
        "form_filling": bool(perm & PDF_PERM_FORM) if is_encrypted else True,
        "modification": bool(perm & PDF_PERM_MODIFY) if is_encrypted else True,
        "assembly": bool(perm & PDF_PERM_ASSEMBLE) if is_encrypted else True,
    }

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "is_encrypted": is_encrypted,
            "encryption_algorithm": encryption_algorithm,
            "permissions": permissions,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
