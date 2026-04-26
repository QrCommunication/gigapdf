"""
Admin infrastructure endpoints.

Provides cost monitoring and system performance metrics.
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import InfrastructureMetric
from app.schemas.infrastructure import (
    CostHistoryResponse,
    CurrentCostsResponse,
    CurrentMetricsResponse,
    MetricPoint,
    MetricsHistoryResponse,
)
from app.services.infra_metrics_service import infra_metrics_service
from app.services.scaleway_service import scaleway_service

router = APIRouter()


# =============================================================================
# Cost Endpoints
# =============================================================================


@router.get(
    "/costs/current",
    response_model=CurrentCostsResponse,
    summary="Get current billing period costs",
    description=(
        "Retrieve the cost breakdown for the current (or specified) billing period from Scaleway.\n\n"
        "**Admin access required.** Returns a detailed breakdown by resource category "
        "(compute, storage, bandwidth, etc.) and individual resource line items.\n\n"
        "**Query parameter:** `billing_period` — period in `YYYY-MM` format. "
        "Defaults to the current calendar month if omitted."
    ),
    response_description="Current costs with category breakdown and resource line items",
    responses={
        200: {"description": "Cost data for the requested billing period"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
        422: {"description": "Validation error — billing_period must match YYYY-MM format"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/current?billing_period=2025-03" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/current",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    '    params={"billing_period": "2025-03"},\n'
                    ")\n"
                    "costs = response.json()"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/current?billing_period=2025-03",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const costs = await response.json();"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/current?billing_period=2025-03');\n"
                    "curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]]);\n"
                    "$costs = json_decode(curl_exec($ch), true);"
                ),
            },
        ]
    },
)
async def get_current_costs(
    billing_period: str | None = Query(
        None,
        description="Billing period in YYYY-MM format. Defaults to current month.",
        regex=r"^\d{4}-\d{2}$",
    ),
):
    """
    Get current billing period costs from Scaleway.

    Returns detailed breakdown by category and individual resources.
    """
    return scaleway_service.get_current_costs(billing_period=billing_period)


@router.get(
    "/costs/history",
    response_model=CostHistoryResponse,
    summary="Get historical cost data",
    description=(
        "Retrieve monthly cost history for the past N months from Scaleway.\n\n"
        "**Admin access required.** Returns monthly totals and a per-category breakdown "
        "for each month, useful for trend analysis and budget forecasting.\n\n"
        "**Query parameter:** `months` — number of past months to include (1–24, default: 12)."
    ),
    response_description="Monthly cost history with per-category breakdown",
    responses={
        200: {"description": "Cost history for the requested number of months"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
        422: {"description": "Validation error — months must be between 1 and 24"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/history?months=6" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/history",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    '    params={"months": 6},\n'
                    ")\n"
                    "history = response.json()"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/history?months=6",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const history = await response.json();"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/infrastructure/costs/history?months=6');\n"
                    "curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]]);\n"
                    "$history = json_decode(curl_exec($ch), true);"
                ),
            },
        ]
    },
)
async def get_costs_history(
    months: int = Query(12, ge=1, le=24, description="Number of months to retrieve"),
):
    """
    Get historical cost data.

    Returns monthly cost totals and category breakdown.
    """
    return scaleway_service.get_cost_history(months=months)


# =============================================================================
# Metrics Endpoints
# =============================================================================


@router.get(
    "/metrics/current",
    response_model=CurrentMetricsResponse,
    summary="Get real-time system metrics",
    description=(
        "Retrieve live system performance metrics at the moment of the request.\n\n"
        "**Admin access required.** Collects and returns CPU usage percentage, "
        "memory (used/total/percent), disk (used/total/percent), "
        "network (rx/tx bytes), and S3 storage statistics.\n\n"
        "Data is collected in real-time by the infra metrics service — "
        "for historical trends, use `/metrics/history` instead."
    ),
    response_description="Current CPU, memory, disk, network, and S3 metrics",
    responses={
        200: {"description": "Real-time system metrics"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/current" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/current",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    ")\n"
                    "metrics = response.json()\n"
                    'print(f"CPU: {metrics[\'cpu\'][\'percent\']}%  MEM: {metrics[\'memory\'][\'percent\']}%")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/current",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const metrics = await response.json();\n"
                    "console.log(`CPU: ${metrics.cpu.percent}%  MEM: ${metrics.memory.percent}%`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/current');\n"
                    "curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]]);\n"
                    "$metrics = json_decode(curl_exec($ch), true);\n"
                    "echo 'CPU: ' . $metrics['cpu']['percent'] . '%';"
                ),
            },
        ]
    },
)
async def get_current_metrics():
    """
    Get real-time system performance metrics.

    Collects CPU, memory, disk, network, and S3 usage statistics.
    """
    return infra_metrics_service.get_current_metrics()


@router.get(
    "/metrics/history",
    response_model=MetricsHistoryResponse,
    summary="Get historical system metrics",
    description=(
        "Retrieve time-series system metrics for chart rendering and trend analysis.\n\n"
        "**Admin access required.** Queries the database for stored metric snapshots "
        "within the specified time range. Each data point includes CPU, memory, disk "
        "percentages, and S3 usage (MB).\n\n"
        "**Query parameter:** `time_range` — one of `24h` (last 24 hours), "
        "`7d` (last 7 days), or `30d` (last 30 days). Default: `24h`.\n\n"
        "Metrics are recorded automatically by Celery Beat in production. "
        "Use `POST /metrics/collect` to trigger a manual snapshot."
    ),
    response_description="Time-series metric data points for the requested range",
    responses={
        200: {"description": "Historical metric data points"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
        422: {"description": "Validation error — time_range must be 24h, 7d, or 30d"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/history?time_range=7d" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/history",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    '    params={"time_range": "7d"},\n'
                    ")\n"
                    "data = response.json()\n"
                    'print(f"{len(data[\'points\'])} data points over {data[\'range\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/history?time_range=7d",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const { range, points } = await response.json();\n"
                    "console.log(`${points.length} points over ${range}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/history?time_range=7d');\n"
                    "curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]]);\n"
                    "$data = json_decode(curl_exec($ch), true);\n"
                    "echo count($data['points']) . ' points over ' . $data['range'];"
                ),
            },
        ]
    },
)
async def get_metrics_history(
    time_range: Literal["24h", "7d", "30d"] = Query(
        "24h", description="Time range for historical data"
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get historical system metrics for charts.

    Returns data points within the specified time range.
    """
    # Calculate cutoff time
    now = datetime.utcnow()
    if time_range == "24h":
        cutoff = now - timedelta(hours=24)
    elif time_range == "7d":
        cutoff = now - timedelta(days=7)
    elif time_range == "30d":
        cutoff = now - timedelta(days=30)
    else:
        cutoff = now - timedelta(hours=24)

    # Query metrics (async)
    stmt = (
        select(InfrastructureMetric)
        .where(InfrastructureMetric.recorded_at >= cutoff)
        .order_by(InfrastructureMetric.recorded_at.asc())
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    # Convert to data points
    points: list[MetricPoint] = []
    for record in records:
        # Calculate percentages
        mem_percent = 0.0
        if record.memory_total_bytes and record.memory_used_bytes:
            mem_percent = (record.memory_used_bytes / record.memory_total_bytes) * 100

        disk_percent = 0.0
        if record.disk_total_bytes and record.disk_used_bytes:
            disk_percent = (record.disk_used_bytes / record.disk_total_bytes) * 100

        s3_mb = None
        if record.s3_total_bytes is not None:
            s3_mb = record.s3_total_bytes / (1024**2)

        points.append(
            MetricPoint(
                time=record.recorded_at,
                cpu=round(record.cpu_percent or 0, 1),
                memory=round(mem_percent, 1),
                disk=round(disk_percent, 1),
                s3_mb=round(s3_mb, 2) if s3_mb else None,
            )
        )

    return MetricsHistoryResponse(range=time_range, points=points)


@router.post(
    "/metrics/collect",
    summary="Trigger manual metrics collection",
    description=(
        "Manually collect and persist a system metrics snapshot to the database.\n\n"
        "**Admin access required.** Collects current CPU, memory, disk, network, and S3 "
        "metrics via the infra metrics service, saves the record to the database, and "
        "returns the record ID and timestamp.\n\n"
        "This endpoint is intended for testing and on-demand snapshots. "
        "In production, metric collection runs automatically via Celery Beat on a schedule."
    ),
    response_description="Confirmation with the saved record ID and timestamp",
    responses={
        200: {"description": "Metrics collected and saved successfully"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/collect" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.post(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/collect",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    ")\n"
                    "result = response.json()\n"
                    'print(f"Saved record {result[\'record_id\']} at {result[\'recorded_at\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/collect",\n'
                    '  { method: "POST", headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.record_id, result.recorded_at);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/infrastructure/metrics/collect');\n"
                    "curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken]]);\n"
                    "$result = json_decode(curl_exec($ch), true);\n"
                    "echo $result['record_id'] . ' — ' . $result['recorded_at'];"
                ),
            },
        ]
    },
)
async def trigger_metrics_collection(
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger metrics collection.

    This endpoint is mainly for testing. In production,
    metrics are collected automatically by Celery Beat.
    """
    metrics = infra_metrics_service.collect_current_metrics()

    # Save to database (async version)
    record = InfrastructureMetric(
        cpu_percent=metrics.get("cpu_percent"),
        memory_used_bytes=metrics.get("memory_used_bytes"),
        memory_total_bytes=metrics.get("memory_total_bytes"),
        disk_used_bytes=metrics.get("disk_used_bytes"),
        disk_total_bytes=metrics.get("disk_total_bytes"),
        s3_objects_count=metrics.get("s3_objects_count"),
        s3_total_bytes=metrics.get("s3_total_bytes"),
        network_rx_bytes=metrics.get("network_rx_bytes"),
        network_tx_bytes=metrics.get("network_tx_bytes"),
    )

    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "status": "ok",
        "message": "Metrics collected successfully",
        "record_id": record.id,
        "recorded_at": record.recorded_at.isoformat(),
    }
