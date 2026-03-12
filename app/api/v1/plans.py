"""
Plans management endpoints.

Provides CRUD endpoints for subscription plans (admin only).
Public endpoint to list active plans for users.
"""

from decimal import Decimal
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from app.core.database import get_db_session
from app.middleware.request_id import get_request_id
from app.models.database import Plan
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

router = APIRouter()


# Pydantic schemas
class PlanFeatures(BaseModel):
    """Plan features configuration."""

    storageGb: float = Field(description="Storage limit in GB (-1 for unlimited)")
    apiCallsPerMonth: int = Field(description="API calls per month (-1 for unlimited)")
    customBranding: bool = Field(default=False, description="Custom branding enabled")
    prioritySupport: bool = Field(default=False, description="Priority support enabled")
    sla: bool = Field(default=False, description="SLA guarantee enabled")
    dedicatedAccount: bool = Field(default=False, description="Dedicated account manager")


class PlanCreate(BaseModel):
    """Schema for creating a plan."""

    slug: str = Field(min_length=2, max_length=50, description="Unique plan identifier")
    name: str = Field(min_length=2, max_length=100, description="Plan display name")
    description: Optional[str] = Field(None, description="Plan description")
    price: Decimal = Field(ge=0, description="Plan price")
    currency: str = Field(default="EUR", max_length=3, description="Currency code")
    interval: str = Field(default="month", description="Billing interval (month/year)")
    stripe_price_id: Optional[str] = Field(None, description="Stripe Price ID")
    storage_limit_bytes: int = Field(
        default=5 * 1024 * 1024 * 1024, description="Storage limit in bytes"
    )
    api_calls_limit: int = Field(default=1000, description="API calls limit per month")
    document_limit: int = Field(default=100, description="Document limit")
    is_tenant_plan: bool = Field(default=False, description="Is this a tenant/enterprise plan")
    max_members: int = Field(default=1, description="Max members for tenant plans")
    linked_tenant_id: Optional[str] = Field(None, description="If set, plan is exclusive to this tenant")
    features: Optional[PlanFeatures] = Field(None, description="Plan features")
    is_active: bool = Field(default=True, description="Plan is active")
    is_popular: bool = Field(default=False, description="Mark as popular plan")
    display_order: int = Field(default=0, description="Display order")
    cta_text: str = Field(default="Get Started", description="Call-to-action text")
    trial_days: Optional[int] = Field(None, description="Trial period in days")


class PlanUpdate(BaseModel):
    """Schema for updating a plan."""

    name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, max_length=3)
    interval: Optional[str] = None
    stripe_price_id: Optional[str] = None
    storage_limit_bytes: Optional[int] = None
    api_calls_limit: Optional[int] = None
    document_limit: Optional[int] = None
    is_tenant_plan: Optional[bool] = None
    max_members: Optional[int] = None
    linked_tenant_id: Optional[str] = None
    features: Optional[PlanFeatures] = None
    is_active: Optional[bool] = None
    is_popular: Optional[bool] = None
    display_order: Optional[int] = None
    cta_text: Optional[str] = None
    trial_days: Optional[int] = None


class PlanResponse(BaseModel):
    """Plan response schema."""

    id: str
    slug: str
    name: str
    description: Optional[str]
    price: float
    currency: str
    interval: str
    stripe_price_id: Optional[str]
    storage_limit_bytes: int
    api_calls_limit: int
    document_limit: int
    is_tenant_plan: bool
    max_members: int
    linked_tenant_id: Optional[str]
    features: Optional[dict]
    is_active: bool
    is_popular: bool
    display_order: int
    cta_text: str
    trial_days: Optional[int]
    created_at: str
    updated_at: str


def plan_to_response(plan: Plan) -> PlanResponse:
    """Convert Plan model to response schema."""
    return PlanResponse(
        id=plan.id,
        slug=plan.slug,
        name=plan.name,
        description=plan.description,
        price=float(plan.price),
        currency=plan.currency,
        interval=plan.interval,
        stripe_price_id=plan.stripe_price_id,
        storage_limit_bytes=plan.storage_limit_bytes,
        api_calls_limit=plan.api_calls_limit,
        document_limit=plan.document_limit,
        is_tenant_plan=plan.is_tenant_plan,
        max_members=plan.max_members,
        linked_tenant_id=plan.linked_tenant_id,
        features=plan.features,
        is_active=plan.is_active,
        is_popular=plan.is_popular,
        display_order=plan.display_order,
        cta_text=plan.cta_text,
        trial_days=plan.trial_days,
        created_at=plan.created_at.isoformat(),
        updated_at=plan.updated_at.isoformat(),
    )


@router.get(
    "",
    response_model=APIResponse[dict],
    summary="List all subscription plans",
    description="""
Retrieve the list of subscription plans available on the platform.

Returns active non-tenant plans by default, sorted by `display_order`.
Use `include_inactive=true` to also retrieve disabled plans (admin only).
Use `include_tenant_plans=true` to include organization-specific plans.
Use `tenant_id` to also return private plans associated with a specific tenant.

**No authentication required** for public plan listing.
""",
    response_description="Object containing a `plans` array with all matching plan objects",
    responses={
        200: {"description": "Plans retrieved successfully"},
        422: {"description": "Invalid query parameter"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/plans" \\\n  -H "Accept: application/json"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get("https://api.giga-pdf.com/api/v1/plans")\nplans = response.json()["data"]["plans"]\nfor plan in plans:\n    print(f"{plan[\'name\']}: \u20ac{plan[\'price\']}/{plan[\'interval\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/plans');\nconst { data: { plans } } = await response.json();\nplans.forEach(plan => console.log(`${plan.name}: \u20ac${plan.price}/${plan.interval}`));",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$response = file_get_contents('https://api.giga-pdf.com/api/v1/plans');\n$data = json_decode($response, true);\nforeach ($data['data']['plans'] as $plan) {\n    echo \"{$plan['name']}: \u20ac{$plan['price']}/{$plan['interval']}\\n\";\n}",
            },
        ]
    },
)
async def list_plans(
    include_inactive: bool = False,
    include_tenant_plans: bool = False,
    tenant_id: Optional[str] = Query(None, description="Filter to include plans for this tenant"),
) -> APIResponse[dict]:
    """
    List all subscription plans.

    Args:
        include_inactive: Include inactive plans (admin only).
        include_tenant_plans: Include tenant-specific plans (admin only).
        tenant_id: Optional tenant ID to include private plans for that tenant.

    Returns:
        List of plans wrapped in { plans: [...] }.
    """
    async with get_db_session() as session:
        stmt = select(Plan)
        if not include_inactive:
            stmt = stmt.where(Plan.is_active == True)
        if not include_tenant_plans:
            stmt = stmt.where(Plan.is_tenant_plan == False)

        # Filter private plans (linked_tenant_id)
        # By default, only show public plans (linked_tenant_id is NULL)
        # If tenant_id is provided, also include plans linked to that tenant
        if tenant_id:
            # Show public plans OR plans linked to this specific tenant
            stmt = stmt.where(
                (Plan.linked_tenant_id == None) | (Plan.linked_tenant_id == tenant_id)
            )
        else:
            # Only show public plans (no linked tenant)
            stmt = stmt.where(Plan.linked_tenant_id == None)

        stmt = stmt.order_by(Plan.display_order)

        result = await session.execute(stmt)
        plans = result.scalars().all()

        return APIResponse(
            success=True,
            data={"plans": [plan_to_response(p) for p in plans]},
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.get(
    "/{plan_id}",
    response_model=APIResponse[PlanResponse],
    summary="Get a plan by ID or slug",
    description="""
Retrieve full details for a specific subscription plan.

The `plan_id` path parameter accepts either:
- A plan **UUID** (e.g. `3f6a1c2e-...`)
- A plan **slug** (e.g. `starter`, `pro`, `enterprise`)

**No authentication required.**
""",
    response_description="Plan object with all pricing and feature details",
    responses={
        200: {"description": "Plan found and returned"},
        404: {"description": "Plan not found for the given ID or slug"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/plans/starter" \\\n  -H "Accept: application/json"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get("https://api.giga-pdf.com/api/v1/plans/starter")\nplan = response.json()["data"]\nprint(f"Storage: {plan[\'storage_limit_bytes\'] / 1024**3:.0f} GB")\nprint(f"API calls/month: {plan[\'api_calls_limit\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/plans/starter');\nconst { data: plan } = await response.json();\nconsole.log(`${plan.name}: \u20ac${plan.price}/${plan.interval}`);",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$response = file_get_contents('https://api.giga-pdf.com/api/v1/plans/starter');\n$plan = json_decode($response, true)['data'];\necho \"{$plan['name']}: \u20ac{$plan['price']}/{$plan['interval']}\\n\";",
            },
        ]
    },
)
async def get_plan(plan_id: str) -> APIResponse[PlanResponse]:
    """
    Get a plan by ID or slug.

    Args:
        plan_id: Plan UUID or slug.

    Returns:
        Plan details.
    """
    async with get_db_session() as session:
        # Try to find by slug first, then by ID
        stmt = select(Plan).where((Plan.slug == plan_id) | (Plan.id == plan_id))
        result = await session.execute(stmt)
        plan = result.scalar_one_or_none()

        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Plan not found: {plan_id}",
            )

        return APIResponse(
            success=True,
            data=plan_to_response(plan),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.post(
    "",
    response_model=APIResponse[PlanResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create a new subscription plan",
    description="""
Create a new subscription plan on the platform.

**Admin only** — requires a valid admin Bearer token.

The `slug` must be unique and URL-safe (e.g. `business-plus`).
Optionally link a Stripe Price ID (`stripe_price_id`) to enable checkout for this plan.
Set `linked_tenant_id` to make the plan exclusive to a specific organization.

**Conflict**: Returns `409` if a plan with the same slug already exists.
""",
    response_description="Created plan object with all fields including generated UUID and timestamps",
    responses={
        201: {"description": "Plan created successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Insufficient privileges — admin access required"},
        409: {"description": "A plan with this slug already exists"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/plans" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n  -d \'{"slug":"business","name":"Business","description":"For growing businesses","price":49,"storage_limit_bytes":214748364800,"api_calls_limit":200000,"document_limit":5000,"display_order":3}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/plans",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    json={\n        "slug": "business",\n        "name": "Business",\n        "description": "For growing businesses",\n        "price": 49,\n        "storage_limit_bytes": 214748364800,\n        "api_calls_limit": 200000,\n        "document_limit": 5000,\n    }\n)\nplan = response.json()["data"]\nprint(f"Created plan: {plan[\'id\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/plans', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': `Bearer ${adminToken}`\n  },\n  body: JSON.stringify({\n    slug: 'business',\n    name: 'Business',\n    price: 49,\n    storage_limit_bytes: 214748364800,\n    api_calls_limit: 200000,\n  })\n});\nconst { data: plan } = await response.json();",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$ch = curl_init('https://api.giga-pdf.com/api/v1/plans');\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => [\n        'Content-Type: application/json',\n        'Authorization: Bearer ' . $adminToken\n    ],\n    CURLOPT_POSTFIELDS => json_encode([\n        'slug' => 'business',\n        'name' => 'Business',\n        'price' => 49,\n        'storage_limit_bytes' => 214748364800,\n        'api_calls_limit' => 200000,\n    ])\n]);\n$plan = json_decode(curl_exec($ch), true)['data'];",
            },
        ]
    },
)
async def create_plan(plan_data: PlanCreate) -> APIResponse[PlanResponse]:
    """
    Create a new subscription plan.

    Args:
        plan_data: Plan creation data.

    Returns:
        Created plan.
    """
    async with get_db_session() as session:
        # Check if slug already exists
        stmt = select(Plan).where(Plan.slug == plan_data.slug)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Plan with slug '{plan_data.slug}' already exists",
            )

        # Create new plan
        plan = Plan(
            id=str(uuid4()),
            slug=plan_data.slug,
            name=plan_data.name,
            description=plan_data.description,
            price=plan_data.price,
            currency=plan_data.currency,
            interval=plan_data.interval,
            stripe_price_id=plan_data.stripe_price_id,
            storage_limit_bytes=plan_data.storage_limit_bytes,
            api_calls_limit=plan_data.api_calls_limit,
            document_limit=plan_data.document_limit,
            is_tenant_plan=plan_data.is_tenant_plan,
            max_members=plan_data.max_members,
            linked_tenant_id=plan_data.linked_tenant_id,
            features=plan_data.features.model_dump() if plan_data.features else None,
            is_active=plan_data.is_active,
            is_popular=plan_data.is_popular,
            display_order=plan_data.display_order,
            cta_text=plan_data.cta_text,
            trial_days=plan_data.trial_days,
        )

        session.add(plan)
        await session.commit()
        await session.refresh(plan)

        return APIResponse(
            success=True,
            data=plan_to_response(plan),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.patch(
    "/{plan_id}",
    response_model=APIResponse[PlanResponse],
    summary="Update an existing plan",
    description="""
Partially update an existing subscription plan.

**Admin only** — requires a valid admin Bearer token.

Only the fields provided in the request body will be updated (PATCH semantics).
The `plan_id` accepts either a UUID or a slug.

**Note**: Changing `stripe_price_id` will affect new checkouts but not existing subscriptions.
""",
    response_description="Updated plan object with all fields",
    responses={
        200: {"description": "Plan updated successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Insufficient privileges — admin access required"},
        404: {"description": "Plan not found for the given ID or slug"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X PATCH "https://api.giga-pdf.com/api/v1/plans/starter" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n  -d \'{"price": 12, "is_popular": true}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.patch(\n    "https://api.giga-pdf.com/api/v1/plans/starter",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    json={"price": 12, "is_popular": True}\n)\nplan = response.json()["data"]',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/plans/starter', {\n  method: 'PATCH',\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': `Bearer ${adminToken}`\n  },\n  body: JSON.stringify({ price: 12, is_popular: true })\n});\nconst { data: plan } = await response.json();",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$ch = curl_init('https://api.giga-pdf.com/api/v1/plans/starter');\ncurl_setopt_array($ch, [\n    CURLOPT_CUSTOMREQUEST => 'PATCH',\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => [\n        'Content-Type: application/json',\n        'Authorization: Bearer ' . $adminToken\n    ],\n    CURLOPT_POSTFIELDS => json_encode(['price' => 12, 'is_popular' => true])\n]);\n$plan = json_decode(curl_exec($ch), true)['data'];",
            },
        ]
    },
)
async def update_plan(
    plan_id: str, plan_data: PlanUpdate
) -> APIResponse[PlanResponse]:
    """
    Update an existing plan.

    Args:
        plan_id: Plan UUID or slug.
        plan_data: Update data.

    Returns:
        Updated plan.
    """
    async with get_db_session() as session:
        # Find plan
        stmt = select(Plan).where((Plan.slug == plan_id) | (Plan.id == plan_id))
        result = await session.execute(stmt)
        plan = result.scalar_one_or_none()

        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Plan not found: {plan_id}",
            )

        # Update fields
        update_data = plan_data.model_dump(exclude_unset=True)
        if "features" in update_data and update_data["features"]:
            update_data["features"] = update_data["features"].model_dump()

        for key, value in update_data.items():
            setattr(plan, key, value)

        await session.commit()
        await session.refresh(plan)

        return APIResponse(
            success=True,
            data=plan_to_response(plan),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.delete(
    "/{plan_id}",
    response_model=APIResponse[dict],
    summary="Delete a subscription plan",
    description="""
Permanently delete a subscription plan.

**Admin only** — requires a valid admin Bearer token.

**Restrictions**:
- Core plans (`free`, `starter`, `pro`, `enterprise`) cannot be deleted. Deactivate them instead via PATCH.
- Plans with active subscribers should be deactivated rather than deleted.

The `plan_id` accepts either a UUID or a slug.
""",
    response_description="Deletion confirmation with the plan name",
    responses={
        200: {"description": "Plan deleted successfully"},
        400: {"description": "Cannot delete a core plan — deactivate it instead"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Insufficient privileges — admin access required"},
        404: {"description": "Plan not found for the given ID or slug"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/plans/old-plan" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.delete(\n    "https://api.giga-pdf.com/api/v1/plans/old-plan",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"}\n)\nprint(response.json()["data"]["message"])',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/plans/old-plan', {\n  method: 'DELETE',\n  headers: { 'Authorization': `Bearer ${adminToken}` }\n});\nconst { data } = await response.json();\nconsole.log(data.message);",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$ch = curl_init('https://api.giga-pdf.com/api/v1/plans/old-plan');\ncurl_setopt_array($ch, [\n    CURLOPT_CUSTOMREQUEST => 'DELETE',\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]\n]);\n$result = json_decode(curl_exec($ch), true);\necho $result['data']['message'];",
            },
        ]
    },
)
async def delete_plan(plan_id: str) -> APIResponse[dict]:
    """
    Delete a plan.

    Args:
        plan_id: Plan UUID or slug.

    Returns:
        Deletion confirmation.
    """
    async with get_db_session() as session:
        # Find plan
        stmt = select(Plan).where((Plan.slug == plan_id) | (Plan.id == plan_id))
        result = await session.execute(stmt)
        plan = result.scalar_one_or_none()

        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Plan not found: {plan_id}",
            )

        # Prevent deletion of core plans
        if plan.slug in ["free", "starter", "pro", "enterprise"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete core plan: {plan.slug}. Deactivate it instead.",
            )

        plan_name = plan.name
        await session.delete(plan)
        await session.commit()

        return APIResponse(
            success=True,
            data={"message": f"Plan '{plan_name}' deleted successfully"},
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )
