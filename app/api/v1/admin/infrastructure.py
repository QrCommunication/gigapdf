"""
Admin infrastructure endpoints.

Provides cost monitoring and system performance metrics.
"""

from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import InfrastructureMetric
from app.schemas.infrastructure import (
    CostHistoryResponse,
    CurrentCostsResponse,
    CurrentMetricsResponse,
    DiskMetrics,
    MemoryMetrics,
    MetricPoint,
    MetricsHistoryResponse,
    NetworkMetrics,
    S3Metrics,
)
from app.services.infra_metrics_service import infra_metrics_service
from app.services.scaleway_service import scaleway_service

router = APIRouter()


# =============================================================================
# Cost Endpoints
# =============================================================================


@router.get("/costs/current", response_model=CurrentCostsResponse)
async def get_current_costs(
    billing_period: Optional[str] = Query(
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


@router.get("/costs/history", response_model=CostHistoryResponse)
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


@router.get("/metrics/current", response_model=CurrentMetricsResponse)
async def get_current_metrics():
    """
    Get real-time system performance metrics.

    Collects CPU, memory, disk, network, and S3 usage statistics.
    """
    return infra_metrics_service.get_current_metrics()


@router.get("/metrics/history", response_model=MetricsHistoryResponse)
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


@router.post("/metrics/collect")
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
