"""
Request ID middleware for request tracing.

Generates or extracts a unique request ID for each request,
enabling distributed tracing and debugging.
"""

import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Context variable to store the current request ID
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """
    Get the current request ID from context.

    Returns:
        Optional[str]: The current request ID or None if not set.
    """
    return request_id_var.get()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware that assigns a unique ID to each request.

    The request ID is either extracted from the X-Request-ID header
    or generated as a new UUID v4.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """
        Process the request and add request ID.

        Args:
            request: The incoming request.
            call_next: The next middleware/endpoint to call.

        Returns:
            Response: The response with X-Request-ID header.
        """
        # Extract or generate request ID
        request_id = request.headers.get("X-Request-ID")
        if not request_id:
            request_id = str(uuid.uuid4())

        # Set context variable
        token = request_id_var.set(request_id)

        # Attach request_id to the active Sentry scope so every event emitted
        # during this request carries a traceable identifier.
        try:
            import sentry_sdk

            sentry_sdk.set_tag("request_id", request_id)
        except ImportError:
            pass

        try:
            # Process request
            response = await call_next(request)

            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id

            return response
        finally:
            # Reset context variable
            request_id_var.reset(token)
