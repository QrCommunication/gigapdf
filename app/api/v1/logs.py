"""
Frontend log ingestion endpoint.

Receives batched log entries from the @giga-pdf/logger RemoteTransport
(packages/logger/src/transports/remote.ts) and re-emits them into the
Python structured logging pipeline under the "frontend" logger.

Contract (mirrors RemoteTransport.send):
    POST /api/v1/logs
    Content-Type: application/json
    {
        "logs": [LogEntry, ...],          # batch, flushed every 5s or 10 entries
        "clientInfo": {                   # optional browser metadata
            "userAgent": "...",
            "url": "...",
            "timestamp": "ISO-8601"
        }
    }

Auth: the RemoteTransport sends NO Authorization header by default, so
anonymous ingestion is accepted — but rate-limited per client IP using the
project rate-limit pattern (app.middleware.rate_limiter.check_rate_limit)
with a dedicated "logs" bucket so log bursts cannot starve other API calls.
When an Authorization header IS present (custom transport headers), the
user is resolved via OptionalUser and attached to the log records.

PII policy: messages and free-form fields are truncated (2000 chars) and
only whitelisted context keys are forwarded — never the raw payload.
"""

import json
import logging
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.i18n import get_translation, parse_accept_language
from app.middleware.auth import OptionalUser
from app.middleware.rate_limiter import check_rate_limit
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

# Dedicated logger so frontend entries are filterable/routable independently
# of backend logs (e.g. different handler, level, or file in logging config).
frontend_logger = logging.getLogger("frontend")

router = APIRouter()

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------

MAX_BATCH_SIZE = 100
MAX_MESSAGE_LENGTH = 2000
MAX_FIELD_LENGTH = 512  # short string fields (url, userAgent, ids...)

# Frontend LogLevel → Python logging level
_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
    "fatal": logging.CRITICAL,
}

# Context keys forwarded to backend logs (whitelist — anti-PII)
_CONTEXT_WHITELIST = ("requestId", "userId", "documentId")


def _truncate(value: str | None, limit: int) -> str | None:
    """Truncate a string to *limit* characters, marking the cut."""
    if value is None:
        return None
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"  # ellipsis marks truncation


def _compact_json(value: dict[str, Any] | None, limit: int) -> str | None:
    """Serialize a dict compactly and truncate the result."""
    if not value:
        return None
    try:
        serialized = json.dumps(value, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        serialized = str(value)
    return _truncate(serialized, limit)


# ---------------------------------------------------------------------------
# Request schemas (mirror packages/logger/src/logger.ts LogEntry)
# ---------------------------------------------------------------------------


class ClientInfo(BaseModel):
    """Browser metadata attached by RemoteTransport.getClientInfo()."""

    model_config = ConfigDict(extra="ignore")

    user_agent: str | None = Field(default=None, alias="userAgent", max_length=1024)
    url: str | None = Field(default=None, max_length=2048)
    timestamp: str | None = Field(default=None, max_length=64)


class FrontendLogEntry(BaseModel):
    """One LogEntry as produced by packages/logger Logger.createEntry()."""

    model_config = ConfigDict(extra="ignore")

    timestamp: str = Field(max_length=64, description="ISO timestamp from the client")
    level: Literal["debug", "info", "warn", "error", "fatal"] = Field(
        description="Frontend log level"
    )
    message: str = Field(description="Log message (truncated server-side to 2000 chars)")
    context: dict[str, Any] | None = Field(
        default=None, description="Tracing context (requestId, userId, documentId...)"
    )
    data: dict[str, Any] | None = Field(
        default=None, description="Additional structured data"
    )
    error: dict[str, Any] | None = Field(
        default=None, description="Serialized error (name, message, stack...)"
    )
    performance: dict[str, Any] | None = Field(
        default=None, description="Performance timing info (operation, duration...)"
    )

    @field_validator("message", mode="after")
    @classmethod
    def truncate_message(cls, value: str) -> str:
        """Anti-PII / anti-flood: never store more than 2000 chars per message."""
        return _truncate(value, MAX_MESSAGE_LENGTH) or ""


class LogsIngestRequest(BaseModel):
    """Payload sent by RemoteTransport.send()."""

    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
        json_schema_extra={
            "example": {
                "logs": [
                    {
                        "timestamp": "2026-06-13T10:30:00.000Z",
                        "level": "error",
                        "message": "Failed to render page 3",
                        "context": {"documentId": "doc-abc123"},
                        "error": {"name": "RenderError", "message": "Canvas lost"},
                    }
                ],
                "clientInfo": {
                    "userAgent": "Mozilla/5.0 ...",
                    "url": "https://giga-pdf.com/editor/doc-abc123",
                    "timestamp": "2026-06-13T10:30:01.000Z",
                },
            }
        },
    )

    logs: list[FrontendLogEntry] = Field(
        min_length=1,
        max_length=MAX_BATCH_SIZE,
        description=f"Batch of log entries (max {MAX_BATCH_SIZE})",
    )
    client_info: ClientInfo | None = Field(default=None, alias="clientInfo")


# ---------------------------------------------------------------------------
# Rate limiting — project pattern (app.middleware.rate_limiter), dedicated
# "logs" bucket so anonymous log floods are isolated from other endpoints.
# Mirrors rate_limit_dependency() but pins the category.
# ---------------------------------------------------------------------------


async def logs_rate_limit_dependency(
    request: Request,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> None:
    """Rate-limit log ingestion per user (authenticated) or per IP (anonymous)."""
    user_id: str | None = getattr(request.state, "user_id", None)
    is_allowed, info = await check_rate_limit(request, user_id=user_id, category="logs")

    if not is_allowed:
        language = parse_accept_language(accept_language)
        message = get_translation(
            "RATE_LIMIT_EXCEEDED",
            language,
            seconds=info["reset_in"],
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMIT_EXCEEDED",
                "message": message,
                "details": {
                    "limit": info["limit"],
                    "reset_in_seconds": info["reset_in"],
                },
            },
            headers={
                "X-RateLimit-Limit": str(info["limit"]),
                "X-RateLimit-Remaining": str(info["remaining"]),
                "X-RateLimit-Reset": str(info["reset_in"]),
                "Retry-After": str(info["reset_in"]),
            },
        )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=APIResponse[dict],
    summary="Ingest frontend logs",
    response_description="Number of log entries accepted",
    description="""Receive a batch of structured log entries from the frontend logger
(@giga-pdf/logger RemoteTransport) and forward them to the backend logging pipeline.

**Contract:**
- Batch of 1 to 100 entries per request
- Anonymous requests accepted (the frontend transport sends no auth header),
  rate-limited per client IP
- Messages are truncated to 2000 characters server-side (anti-PII/anti-flood)
- Entries are re-emitted under the Python logger `frontend` with the mapped level
  (`warn` → WARNING, `fatal` → CRITICAL)

This endpoint never fails on individual malformed optional fields — only the
envelope (batch size, levels, required fields) is strictly validated.""",
    responses={
        200: {
            "description": "Batch accepted and forwarded to backend logging.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {"accepted": 3},
                        "meta": {
                            "request_id": "req-xyz",
                            "timestamp": "2026-06-13T10:30:01Z",
                            "processing_time_ms": 2,
                        },
                    }
                }
            },
        },
        422: {"description": "Invalid payload (empty batch, batch > 100, unknown level...)"},
        429: {"description": "Rate limit exceeded"},
    },
)
async def ingest_frontend_logs(
    payload: LogsIngestRequest,
    request: Request,
    user: OptionalUser = None,
    _rate_limit: Annotated[None, Depends(logs_rate_limit_dependency)] = None,
) -> APIResponse[dict]:
    """Re-emit frontend log entries into the Python structured logging pipeline."""
    start_time = time.time()

    client_info = payload.client_info
    authenticated_user_id = user.user_id if user else None

    for entry in payload.logs:
        level = _LEVEL_MAP.get(entry.level, logging.INFO)

        # Whitelisted context keys only (anti-PII) — values coerced + truncated.
        context_fields = {}
        if entry.context:
            for key in _CONTEXT_WHITELIST:
                value = entry.context.get(key)
                if value is not None:
                    context_fields[key] = _truncate(str(value), MAX_FIELD_LENGTH)

        extra_parts: list[str] = []
        if context_fields:
            extra_parts.append(f"context={_compact_json(context_fields, MAX_FIELD_LENGTH)}")
        if entry.error:
            error_summary = {
                "name": _truncate(str(entry.error.get("name", "Unknown")), 128),
                "message": _truncate(str(entry.error.get("message", "")), MAX_MESSAGE_LENGTH),
            }
            extra_parts.append(f"error={_compact_json(error_summary, MAX_MESSAGE_LENGTH)}")
        if entry.performance:
            extra_parts.append(
                f"performance={_compact_json(entry.performance, MAX_FIELD_LENGTH)}"
            )
        if entry.data:
            extra_parts.append(f"data={_compact_json(entry.data, MAX_MESSAGE_LENGTH)}")
        if client_info and client_info.url:
            extra_parts.append(f"url={_truncate(client_info.url, MAX_FIELD_LENGTH)}")

        suffix = (" | " + " ".join(extra_parts)) if extra_parts else ""

        frontend_logger.log(
            level,
            "[frontend] %s%s",
            entry.message,
            suffix,
            extra={
                "frontend_timestamp": entry.timestamp,
                "frontend_level": entry.level,
                "auth_user_id": authenticated_user_id,
            },
        )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"accepted": len(payload.logs)},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
