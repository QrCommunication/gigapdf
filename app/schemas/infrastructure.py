"""
Infrastructure monitoring schemas.

Defines request and response models for costs and performance monitoring.
"""

from datetime import datetime

from pydantic import BaseModel, Field

# =============================================================================
# Cost Schemas
# =============================================================================


class CategoryCost(BaseModel):
    """Cost breakdown by category."""

    name: str = Field(description="Category name (Compute, Storage, Network, etc.)")
    cost: float = Field(description="Cost in EUR")
    product_count: int = Field(default=1, description="Number of products in category")


class ResourceCost(BaseModel):
    """Individual resource cost details."""

    product_name: str = Field(description="Product name")
    resource_name: str = Field(description="Resource description")
    category: str = Field(description="Category name")
    cost: float = Field(description="Cost in EUR")
    unit: str = Field(description="Billing unit (minute, gigabyte_hour, etc.)")
    quantity: str = Field(description="Billed quantity")


class CurrentCostsResponse(BaseModel):
    """Current month costs from Scaleway Billing."""

    total_eur: float = Field(description="Total cost in EUR")
    billing_period: str = Field(description="Billing period (YYYY-MM)")
    by_category: list[CategoryCost] = Field(description="Costs grouped by category")
    resources: list[ResourceCost] = Field(default=[], description="Detailed resource costs")

    class Config:
        json_schema_extra = {
            "example": {
                "total_eur": 23.45,
                "billing_period": "2026-01",
                "by_category": [
                    {"name": "Compute", "cost": 10.20, "product_count": 1},
                    {"name": "Managed Databases", "cost": 9.61, "product_count": 1},
                    {"name": "Storage", "cost": 1.21, "product_count": 2},
                    {"name": "Network", "cost": 2.43, "product_count": 2},
                ],
                "resources": [],
            }
        }


class MonthCost(BaseModel):
    """Monthly cost summary."""

    period: str = Field(description="Billing period (YYYY-MM)")
    total: float = Field(description="Total cost in EUR")
    by_category: dict[str, float] = Field(description="Costs by category")


class CostHistoryResponse(BaseModel):
    """Historical cost data."""

    history: list[MonthCost] = Field(description="Monthly cost history")

    class Config:
        json_schema_extra = {
            "example": {
                "history": [
                    {"period": "2025-11", "total": 21.30, "by_category": {"Compute": 10.0, "Storage": 11.30}},
                    {"period": "2025-12", "total": 22.10, "by_category": {"Compute": 10.5, "Storage": 11.60}},
                    {"period": "2026-01", "total": 23.45, "by_category": {"Compute": 10.2, "Storage": 13.25}},
                ]
            }
        }


# =============================================================================
# Metrics Schemas
# =============================================================================


class MemoryMetrics(BaseModel):
    """Memory usage details."""

    used_bytes: int = Field(description="Memory used in bytes")
    total_bytes: int = Field(description="Total memory in bytes")
    used_gb: float = Field(description="Memory used in GB")
    total_gb: float = Field(description="Total memory in GB")
    percent: float = Field(description="Memory usage percentage")


class DiskMetrics(BaseModel):
    """Disk usage details."""

    used_bytes: int = Field(description="Disk used in bytes")
    total_bytes: int = Field(description="Total disk in bytes")
    used_gb: float = Field(description="Disk used in GB")
    total_gb: float = Field(description="Total disk in GB")
    percent: float = Field(description="Disk usage percentage")


class S3Metrics(BaseModel):
    """S3 storage metrics."""

    objects_count: int = Field(description="Number of objects in bucket")
    total_bytes: int = Field(description="Total size in bytes")
    total_mb: float = Field(description="Total size in MB")


class NetworkMetrics(BaseModel):
    """Network I/O metrics."""

    rx_bytes: int = Field(description="Bytes received")
    tx_bytes: int = Field(description="Bytes transmitted")
    rx_mb: float = Field(description="MB received")
    tx_mb: float = Field(description="MB transmitted")


class CurrentMetricsResponse(BaseModel):
    """Current system metrics."""

    recorded_at: datetime = Field(description="Timestamp of metrics")
    cpu_percent: float = Field(description="CPU usage percentage")
    memory: MemoryMetrics = Field(description="Memory metrics")
    disk: DiskMetrics = Field(description="Disk metrics")
    s3: S3Metrics = Field(description="S3 storage metrics")
    network: NetworkMetrics | None = Field(default=None, description="Network metrics")

    class Config:
        json_schema_extra = {
            "example": {
                "recorded_at": "2026-01-20T16:30:00Z",
                "cpu_percent": 34.5,
                "memory": {
                    "used_bytes": 2147483648,
                    "total_bytes": 4294967296,
                    "used_gb": 2.0,
                    "total_gb": 4.0,
                    "percent": 50.0,
                },
                "disk": {
                    "used_bytes": 12884901888,
                    "total_bytes": 42949672960,
                    "used_gb": 12.0,
                    "total_gb": 40.0,
                    "percent": 30.0,
                },
                "s3": {
                    "objects_count": 14,
                    "total_bytes": 5931008,
                    "total_mb": 5.66,
                },
                "network": {
                    "rx_bytes": 1073741824,
                    "tx_bytes": 536870912,
                    "rx_mb": 1024.0,
                    "tx_mb": 512.0,
                },
            }
        }


class MetricPoint(BaseModel):
    """Single metric data point for charts."""

    time: datetime = Field(description="Timestamp")
    cpu: float = Field(description="CPU percentage")
    memory: float = Field(description="Memory percentage")
    disk: float = Field(description="Disk percentage")
    s3_mb: float | None = Field(default=None, description="S3 size in MB")


class MetricsHistoryResponse(BaseModel):
    """Historical metrics for charts."""

    range: str = Field(description="Time range (24h, 7d, 30d)")
    points: list[MetricPoint] = Field(description="Data points")

    class Config:
        json_schema_extra = {
            "example": {
                "range": "24h",
                "points": [
                    {"time": "2026-01-20T10:00:00Z", "cpu": 32.0, "memory": 51.0, "disk": 30.0, "s3_mb": 5.5},
                    {"time": "2026-01-20T10:15:00Z", "cpu": 45.0, "memory": 53.0, "disk": 30.0, "s3_mb": 5.6},
                ],
            }
        }
