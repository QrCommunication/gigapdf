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
Retrieve the current user's quota information including storage usage, API call counts, and subscription plan details.

This endpoint provides a comprehensive overview of the authenticated user's resource consumption and limits. Use this to monitor usage and prevent quota exceeded errors.

## Response Structure
- **storage**: Current storage usage in bytes and limit
- **api_calls**: API calls used this period and monthly limit
- **plan**: Current subscription plan name
- **period**: Billing period information
""",
    responses={
        200: {
            "description": "Quota information retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "storage": {
                                "used_bytes": 1073741824,
                                "limit_bytes": 5368709120,
                                "used_percent": 20.0
                            },
                            "api_calls": {
                                "used": 150,
                                "limit": 1000,
                                "remaining": 850
                            },
                            "plan": "free",
                            "period": {
                                "start": "2024-01-01T00:00:00Z",
                                "end": "2024-01-31T23:59:59Z"
                            }
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/quota/me" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/quota/me",
    headers={"Authorization": f"Bearer {token}"}
)
quota = response.json()["data"]
print(f"Storage: {quota['storage']['used_bytes']} / {quota['storage']['limit_bytes']} bytes")
print(f"API calls: {quota['api_calls']['used']} / {quota['api_calls']['limit']}")
print(f"Plan: {quota['plan']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch("https://api.giga-pdf.com/api/v1/quota/me", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${token}`
  }
});

const { data: quota } = await response.json();
console.log(`Storage: ${quota.storage.used_bytes} / ${quota.storage.limit_bytes} bytes`);
console.log(`API calls: ${quota.api_calls.used} / ${quota.api_calls.limit}`);
console.log(`Plan: ${quota.plan}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/quota/me", [
    "headers" => [
        "Authorization" => "Bearer " . $token
    ]
]);

$quota = json_decode($response->getBody(), true)["data"];
echo "Storage: " . $quota["storage"]["used_bytes"] . " / " . $quota["storage"]["limit_bytes"] . " bytes\\n";
echo "API calls: " . $quota["api_calls"]["used"] . " / " . $quota["api_calls"]["limit"] . "\\n";
echo "Plan: " . $quota["plan"] . "\\n";'''
            }
        ]
    },
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
Retrieve the user's effective resource limits, taking into account tenant/organization membership.

This endpoint determines whether the user's limits should come from their personal subscription plan or from their organization's enterprise plan. Organizations with enterprise plans share pooled resources among all members.

## Response Structure
- **is_tenant_based**: Boolean indicating if limits come from organization
- **tenant**: Organization information (id, name, user's role) if applicable
- **storage**: Storage limits (limit_bytes, used_bytes, available_bytes)
- **api_calls**: API call limits (limit, used, remaining)
- **documents**: Document limits (limit, count)

## Use Cases
- Determine if user is part of an organization
- Check available resources before uploading large documents
- Display appropriate quota information in the UI
""",
    responses={
        200: {
            "description": "Effective limits retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "is_tenant_based": True,
                            "tenant": {
                                "id": "tenant-uuid",
                                "name": "Acme Corp",
                                "role": "member"
                            },
                            "storage": {
                                "limit_bytes": 536870912000,
                                "used_bytes": 10737418240,
                                "available_bytes": 526133493760
                            },
                            "api_calls": {
                                "limit": 500000,
                                "used": 12500,
                                "remaining": 487500
                            },
                            "documents": {
                                "limit": -1,
                                "count": 250
                            }
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/quota/effective" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/quota/effective",
    headers={"Authorization": f"Bearer {token}"}
)
limits = response.json()["data"]

if limits["is_tenant_based"]:
    print(f"Using organization limits: {limits['tenant']['name']}")
    print(f"Your role: {limits['tenant']['role']}")
else:
    print("Using personal plan limits")

print(f"Storage available: {limits['storage']['available_bytes']} bytes")
print(f"API calls remaining: {limits['api_calls']['remaining']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch("https://api.giga-pdf.com/api/v1/quota/effective", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${token}`
  }
});

const { data: limits } = await response.json();

if (limits.is_tenant_based) {
  console.log(`Using organization limits: ${limits.tenant.name}`);
  console.log(`Your role: ${limits.tenant.role}`);
} else {
  console.log("Using personal plan limits");
}

console.log(`Storage available: ${limits.storage.available_bytes} bytes`);
console.log(`API calls remaining: ${limits.api_calls.remaining}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/quota/effective", [
    "headers" => [
        "Authorization" => "Bearer " . $token
    ]
]);

$limits = json_decode($response->getBody(), true)["data"];

if ($limits["is_tenant_based"]) {
    echo "Using organization limits: " . $limits["tenant"]["name"] . "\\n";
    echo "Your role: " . $limits["tenant"]["role"] . "\\n";
} else {
    echo "Using personal plan limits\\n";
}

echo "Storage available: " . $limits["storage"]["available_bytes"] . " bytes\\n";
echo "API calls remaining: " . $limits["api_calls"]["remaining"] . "\\n";'''
            }
        ]
    },
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
Retrieve the list of all available subscription plans with their resource limits.

Use this endpoint to display pricing information and plan comparisons to users. Each plan includes storage limits, API call quotas, and document limits.

## Available Plans
- **free**: 5GB storage, 1,000 API calls/month, 100 documents
- **pro**: 50GB storage, 50,000 API calls/month, 1,000 documents
- **enterprise**: 500GB storage, 500,000 API calls/month, unlimited documents

## Notes
- Document limit of -1 indicates unlimited documents
- Storage limits are provided in gigabytes for display convenience
- API calls reset at the beginning of each billing period
""",
    responses={
        200: {
            "description": "Plans retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "plans": {
                                "free": {
                                    "storage_limit_gb": 5.0,
                                    "api_calls_limit": 1000,
                                    "document_limit": 100
                                },
                                "pro": {
                                    "storage_limit_gb": 50.0,
                                    "api_calls_limit": 50000,
                                    "document_limit": 1000
                                },
                                "enterprise": {
                                    "storage_limit_gb": 500.0,
                                    "api_calls_limit": 500000,
                                    "document_limit": -1
                                }
                            }
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        }
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/quota/plans"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get("https://api.giga-pdf.com/api/v1/quota/plans")
plans = response.json()["data"]["plans"]

for plan_name, limits in plans.items():
    print(f"{plan_name.upper()} Plan:")
    print(f"  Storage: {limits['storage_limit_gb']} GB")
    print(f"  API calls: {limits['api_calls_limit']}/month")
    doc_limit = "Unlimited" if limits['document_limit'] == -1 else limits['document_limit']
    print(f"  Documents: {doc_limit}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch("https://api.giga-pdf.com/api/v1/quota/plans");
const { data: { plans } } = await response.json();

Object.entries(plans).forEach(([planName, limits]) => {
  console.log(`${planName.toUpperCase()} Plan:`);
  console.log(`  Storage: ${limits.storage_limit_gb} GB`);
  console.log(`  API calls: ${limits.api_calls_limit}/month`);
  const docLimit = limits.document_limit === -1 ? "Unlimited" : limits.document_limit;
  console.log(`  Documents: ${docLimit}`);
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/quota/plans");

$plans = json_decode($response->getBody(), true)["data"]["plans"];

foreach ($plans as $planName => $limits) {
    echo strtoupper($planName) . " Plan:\\n";
    echo "  Storage: " . $limits["storage_limit_gb"] . " GB\\n";
    echo "  API calls: " . $limits["api_calls_limit"] . "/month\\n";
    $docLimit = $limits["document_limit"] === -1 ? "Unlimited" : $limits["document_limit"];
    echo "  Documents: " . $docLimit . "\\n";
}'''
            }
        ]
    },
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
