"""
Infrastructure metrics service.

Handles collection and retrieval of system performance metrics.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import boto3
import psutil
from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.database import InfrastructureMetric
from app.schemas.infrastructure import (
    CurrentMetricsResponse,
    DiskMetrics,
    MemoryMetrics,
    MetricPoint,
    MetricsHistoryResponse,
    NetworkMetrics,
    S3Metrics,
)

logger = logging.getLogger(__name__)


class InfraMetricsService:
    """Service for infrastructure metrics collection and retrieval."""

    def __init__(self):
        """Initialize the metrics service."""
        self._s3_client: Optional[boto3.client] = None

    def _get_s3_client(self) -> boto3.client:
        """Get or create S3 client."""
        if self._s3_client is None:
            self._s3_client = boto3.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT,
                aws_access_key_id=settings.S3_ACCESS_KEY_ID,
                aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
                region_name=settings.S3_REGION,
            )
        return self._s3_client

    def collect_current_metrics(self) -> dict:
        """
        Collect current system metrics.

        Returns:
            Dict with all metric values for database storage
        """
        metrics = {}

        # CPU
        try:
            metrics["cpu_percent"] = psutil.cpu_percent(interval=1)
        except Exception as e:
            logger.warning(f"Failed to collect CPU metrics: {e}")
            metrics["cpu_percent"] = None

        # Memory
        try:
            memory = psutil.virtual_memory()
            metrics["memory_used_bytes"] = memory.used
            metrics["memory_total_bytes"] = memory.total
        except Exception as e:
            logger.warning(f"Failed to collect memory metrics: {e}")
            metrics["memory_used_bytes"] = None
            metrics["memory_total_bytes"] = None

        # Disk
        try:
            disk = psutil.disk_usage("/")
            metrics["disk_used_bytes"] = disk.used
            metrics["disk_total_bytes"] = disk.total
        except Exception as e:
            logger.warning(f"Failed to collect disk metrics: {e}")
            metrics["disk_used_bytes"] = None
            metrics["disk_total_bytes"] = None

        # Network
        try:
            net = psutil.net_io_counters()
            metrics["network_rx_bytes"] = net.bytes_recv
            metrics["network_tx_bytes"] = net.bytes_sent
        except Exception as e:
            logger.warning(f"Failed to collect network metrics: {e}")
            metrics["network_rx_bytes"] = None
            metrics["network_tx_bytes"] = None

        # S3
        try:
            s3 = self._get_s3_client()
            response = s3.list_objects_v2(Bucket=settings.S3_BUCKET_NAME)
            metrics["s3_objects_count"] = response.get("KeyCount", 0)
            metrics["s3_total_bytes"] = sum(
                obj["Size"] for obj in response.get("Contents", [])
            )
        except ClientError as e:
            logger.warning(f"Failed to collect S3 metrics: {e}")
            metrics["s3_objects_count"] = None
            metrics["s3_total_bytes"] = None
        except Exception as e:
            logger.warning(f"Failed to collect S3 metrics: {e}")
            metrics["s3_objects_count"] = None
            metrics["s3_total_bytes"] = None

        return metrics

    def get_current_metrics(self) -> CurrentMetricsResponse:
        """
        Get current system metrics as API response.

        Returns:
            CurrentMetricsResponse with all metrics
        """
        metrics = self.collect_current_metrics()
        now = datetime.utcnow()

        # Build memory metrics
        mem_used = metrics.get("memory_used_bytes") or 0
        mem_total = metrics.get("memory_total_bytes") or 1
        memory = MemoryMetrics(
            used_bytes=mem_used,
            total_bytes=mem_total,
            used_gb=round(mem_used / (1024**3), 2),
            total_gb=round(mem_total / (1024**3), 2),
            percent=round((mem_used / mem_total) * 100, 1) if mem_total > 0 else 0,
        )

        # Build disk metrics
        disk_used = metrics.get("disk_used_bytes") or 0
        disk_total = metrics.get("disk_total_bytes") or 1
        disk = DiskMetrics(
            used_bytes=disk_used,
            total_bytes=disk_total,
            used_gb=round(disk_used / (1024**3), 2),
            total_gb=round(disk_total / (1024**3), 2),
            percent=round((disk_used / disk_total) * 100, 1) if disk_total > 0 else 0,
        )

        # Build S3 metrics
        s3_bytes = metrics.get("s3_total_bytes") or 0
        s3 = S3Metrics(
            objects_count=metrics.get("s3_objects_count") or 0,
            total_bytes=s3_bytes,
            total_mb=round(s3_bytes / (1024**2), 2),
        )

        # Build network metrics (optional)
        network = None
        if metrics.get("network_rx_bytes") is not None:
            rx = metrics["network_rx_bytes"]
            tx = metrics["network_tx_bytes"] or 0
            network = NetworkMetrics(
                rx_bytes=rx,
                tx_bytes=tx,
                rx_mb=round(rx / (1024**2), 2),
                tx_mb=round(tx / (1024**2), 2),
            )

        return CurrentMetricsResponse(
            recorded_at=now,
            cpu_percent=metrics.get("cpu_percent") or 0,
            memory=memory,
            disk=disk,
            s3=s3,
            network=network,
        )

    def save_metrics(self, db: Session) -> InfrastructureMetric:
        """
        Collect and save current metrics to database.

        Args:
            db: Database session

        Returns:
            Created InfrastructureMetric record
        """
        metrics = self.collect_current_metrics()

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
        db.commit()
        db.refresh(record)

        logger.info(f"Saved infrastructure metrics: id={record.id}")
        return record

    def get_metrics_history(
        self, db: Session, time_range: str = "24h"
    ) -> MetricsHistoryResponse:
        """
        Get historical metrics for charts.

        Args:
            db: Database session
            time_range: Time range - "24h", "7d", or "30d"

        Returns:
            MetricsHistoryResponse with data points
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

        # Query metrics
        stmt = (
            select(InfrastructureMetric)
            .where(InfrastructureMetric.recorded_at >= cutoff)
            .order_by(InfrastructureMetric.recorded_at.asc())
        )
        results = db.execute(stmt).scalars().all()

        # Convert to data points
        points: list[MetricPoint] = []
        for record in results:
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

    def cleanup_old_metrics(self, db: Session, retention_days: int = 365) -> int:
        """
        Delete metrics older than retention period.

        Args:
            db: Database session
            retention_days: Number of days to keep (default 365)

        Returns:
            Number of deleted records
        """
        cutoff = datetime.utcnow() - timedelta(days=retention_days)

        stmt = select(InfrastructureMetric).where(
            InfrastructureMetric.recorded_at < cutoff
        )
        old_records = db.execute(stmt).scalars().all()
        count = len(old_records)

        for record in old_records:
            db.delete(record)

        db.commit()

        if count > 0:
            logger.info(f"Cleaned up {count} old infrastructure metrics")

        return count


# Singleton instance
infra_metrics_service = InfraMetricsService()
