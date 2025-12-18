"""
Quota management endpoints.

Provides endpoints for viewing and managing user quotas.
"""

from fastapi import APIRouter

from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.quota_service import PLANS, quota_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "/me",
    response_model=APIResponse[dict],
    summary="Get my quota",
    description="""
Get current user's quota information.

Returns storage usage, API call counts, and plan details.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/quota/me" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    "http://localhost:8000/api/v1/quota/me",
    headers={"Authorization": "Bearer <token>"}
)
quota = response.json()["data"]
print(f"Storage: {quota['storage']['used_bytes']} / {quota['storage']['limit_bytes']}")
print(f"API calls: {quota['api_calls']['used']} / {quota['api_calls']['limit']}")
```
""",
)
async def get_my_quota(user: AuthenticatedUser) -> APIResponse[dict]:
    """Get current user's quota summary."""
    summary = await quota_service.get_quota_summary(user.user_id)

    return APIResponse(
        success=True,
        data=summary,
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.get(
    "/effective",
    response_model=APIResponse[dict],
    summary="Get effective limits",
    description="""
Get user's effective limits, considering tenant membership.

If user belongs to a tenant with an enterprise plan, returns tenant limits.
Otherwise returns personal plan limits.

## Response includes:
- **is_tenant_based**: Whether limits come from tenant
- **tenant**: Tenant info if applicable (id, name, role)
- **storage**: Storage limits and usage
- **api_calls**: API call limits and usage
- **documents**: Document limits and count

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/quota/effective" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    "http://localhost:8000/api/v1/quota/effective",
    headers={"Authorization": "Bearer <token>"}
)
limits = response.json()["data"]
if limits["is_tenant_based"]:
    print(f"Using tenant limits: {limits['tenant']['name']}")
print(f"Storage: {limits['storage']['available_bytes']} bytes available")
```
""",
)
async def get_effective_limits(user: AuthenticatedUser) -> APIResponse[dict]:
    """Get user's effective limits (personal or tenant-based)."""
    effective = await quota_service.get_effective_limits(user.user_id)

    return APIResponse(
        success=True,
        data=effective.to_dict(),
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )


@router.get(
    "/plans",
    response_model=APIResponse[dict],
    summary="Get available plans",
    description="""
Get list of available subscription plans with their limits.

## Plans
- **free**: 5GB storage, 1000 API calls/month
- **pro**: 50GB storage, 50,000 API calls/month
- **enterprise**: 500GB storage, 500,000 API calls/month
""",
)
async def get_plans() -> APIResponse[dict]:
    """Get available subscription plans."""
    plans_info = {}
    for plan_name, limits in PLANS.items():
        plans_info[plan_name] = {
            "storage_limit_gb": limits["storage_limit_bytes"] / (1024**3),
            "api_calls_limit": limits["api_calls_limit"],
            "document_limit": limits["document_limit"],
        }

    return APIResponse(
        success=True,
        data={"plans": plans_info},
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )
