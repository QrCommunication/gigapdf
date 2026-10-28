"""
Self-service account management.

``DELETE /api/v1/account`` erases the caller's account (GDPR art. 17) through
:mod:`app.services.account_erasure_service`, the same code path as the admin
``DELETE /api/v1/admin/users/{user_id}``.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth import AuthenticatedUser
from app.middleware.error_handler import GigaPDFException
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.account_erasure_service import (
    AccountErasureReport,
    account_erasure_service,
)
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

router = APIRouter()

#: The literal the user must type, so a stray request cannot erase an account.
ACCOUNT_DELETION_CONFIRMATION = "DELETE"


class AccountDeletionRequest(BaseModel):
    """Explicit confirmation of an irreversible erasure."""

    model_config = ConfigDict(extra="forbid")

    confirmation: Literal["DELETE"] = Field(
        description='Must be exactly "DELETE".', examples=[ACCOUNT_DELETION_CONFIRMATION]
    )


class AccountErasureResponse(BaseModel):
    """Counts of what was removed or anonymised; never personal data."""

    erased: bool = Field(description="Always true once the request succeeds")
    storage_objects_deleted: int
    deleted: dict[str, int] = Field(description="Rows deleted, per table")
    anonymized: dict[str, int] = Field(
        description="Rows kept for other users with the erased identity replaced"
    )

    @classmethod
    def from_report(cls, report: AccountErasureReport) -> "AccountErasureResponse":
        return cls(
            erased=True,
            storage_objects_deleted=report.storage_objects_deleted,
            deleted=report.deleted,
            anonymized=report.anonymized,
        )


class AppSessionRequiredError(GigaPDFException):
    """Account erasure must be done by the person, not by an API integration."""

    def __init__(self) -> None:
        super().__init__(
            "APP_SESSION_REQUIRED",
            "Deleting an account requires signing in to the application; API keys cannot do it.",
            403,
        )


@router.delete(
    "",
    response_model=APIResponse[AccountErasureResponse],
    summary="Delete my account",
    description="""Permanently erase the signed-in user's account (GDPR art. 17).

Deletes every document (all versions, thumbnails, OCR data), folder, job, API key,
notification, share and invitation of the account, its quota, signatures, sessions and
sign-in methods. On documents owned by other users, the account's past contributions
(version authorship, share creation, activity history) are kept but anonymised.

Requires an application session: API keys are refused (`403 APP_SESSION_REQUIRED`).
The body must be `{"confirmation": "DELETE"}` (`422` otherwise).

Refused with `409` when:
- `TENANT_OWNERSHIP_TRANSFER_REQUIRED`: the account owns an organization that other
  members still belong to (`error.details.tenant_ids`). Transfer ownership first.
- `ACTIVE_SUBSCRIPTION_CANCELLATION_REQUIRED`: a paid subscription is still running.

The operation is idempotent: if it fails midway, calling it again completes it.""",
    responses={
        200: {"description": "Account erased"},
        401: {"description": "Not authenticated"},
        403: {"description": "Called with an API key instead of an application session"},
        409: {"description": "Organization ownership or active subscription blocks the erasure"},
        422: {"description": "Missing or wrong confirmation"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X DELETE "https://giga-pdf.com/api/v1/account" \\\n'
                    '  -H "Authorization: Bearer $SESSION_JWT" \\\n'
                    '  -H "Content-Type: application/json" \\\n'
                    "  -d '{\"confirmation\": \"DELETE\"}'"
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.delete(\n"
                    '    "https://giga-pdf.com/api/v1/account",\n'
                    '    headers={"Authorization": f"Bearer {session_jwt}"},\n'
                    '    json={"confirmation": "DELETE"},\n'
                    ")\n"
                    "response.raise_for_status()"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    'await fetch("https://giga-pdf.com/api/v1/account", {\n'
                    '  method: "DELETE",\n'
                    "  headers: {\n"
                    "    Authorization: `Bearer ${sessionJwt}`,\n"
                    '    "Content-Type": "application/json",\n'
                    "  },\n"
                    '  body: JSON.stringify({ confirmation: "DELETE" }),\n'
                    "});"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$client->delete('https://giga-pdf.com/api/v1/account', [\n"
                    "    'headers' => ['Authorization' => 'Bearer ' . $sessionJwt],\n"
                    "    'json' => ['confirmation' => 'DELETE'],\n"
                    "]);"
                ),
            },
        ]
    },
)
async def delete_my_account(
    body: AccountDeletionRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[AccountErasureResponse]:
    """Erase the caller's own account."""
    if getattr(user, "auth_method", "session") != "session":
        raise AppSessionRequiredError()

    report = await account_erasure_service.erase(db, user.user_id)
    return APIResponse(
        success=True,
        data=AccountErasureResponse.from_report(report),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )
