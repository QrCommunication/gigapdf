"""
Scaleway infrastructure service.

Handles communication with Scaleway APIs for billing and monitoring.
"""

import json
import logging
import subprocess
from collections import defaultdict
from datetime import datetime

from app.schemas.infrastructure import (
    CategoryCost,
    CostHistoryResponse,
    CurrentCostsResponse,
    MonthCost,
    ResourceCost,
)

logger = logging.getLogger(__name__)


class ScalewayService:
    """Service for Scaleway API interactions."""

    def __init__(self):
        """Initialize the Scaleway service."""
        self._billing_cache: dict | None = None
        self._billing_cache_time: datetime | None = None
        self._cache_ttl_seconds = 300  # 5 minutes cache

    def _run_scw_command(self, args: list[str]) -> dict | None:
        """
        Run a Scaleway CLI command and return JSON output.

        Args:
            args: Command arguments (e.g., ["billing", "consumption", "list"])

        Returns:
            Parsed JSON output or None on error
        """
        try:
            cmd = ["scw"] + args + ["-o", "json"]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                logger.error(f"scw command failed: {result.stderr}")
                return None

            return json.loads(result.stdout)

        except subprocess.TimeoutExpired:
            logger.error("scw command timed out")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse scw output: {e}")
            return None
        except FileNotFoundError:
            logger.error("scw CLI not found. Please install: curl -s https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh")
            return None
        except Exception as e:
            logger.error(f"scw command error: {e}")
            return None

    def _is_cache_valid(self) -> bool:
        """Check if billing cache is still valid."""
        if self._billing_cache is None or self._billing_cache_time is None:
            return False
        elapsed = (datetime.utcnow() - self._billing_cache_time).total_seconds()
        return elapsed < self._cache_ttl_seconds

    def get_current_costs(self, billing_period: str | None = None) -> CurrentCostsResponse:
        """
        Get current billing period costs from Scaleway.

        Args:
            billing_period: Optional period in YYYY-MM format. Defaults to current month.

        Returns:
            CurrentCostsResponse with costs breakdown
        """
        # Build command args
        args = ["billing", "consumption", "list"]
        if billing_period:
            args.extend(["billing-period", billing_period])

        # Try cache for current month
        if not billing_period and self._is_cache_valid():
            data = self._billing_cache
        else:
            data = self._run_scw_command(args)
            if not billing_period and data:
                self._billing_cache = data
                self._billing_cache_time = datetime.utcnow()

        if not data:
            # Return empty response on error
            return CurrentCostsResponse(
                total_eur=0.0,
                billing_period=billing_period or datetime.utcnow().strftime("%Y-%m"),
                by_category=[],
                resources=[],
            )

        # Parse consumption data
        total = 0.0
        categories: dict[str, dict] = defaultdict(lambda: {"cost": 0.0, "count": 0})
        resources: list[ResourceCost] = []

        for item in data:
            value = item.get("value", {})
            units = value.get("units", 0)
            nanos = value.get("nanos", 0)
            cost = units + (nanos / 1_000_000_000)

            total += cost

            category = item.get("category_name", "Other")
            categories[category]["cost"] += cost
            categories[category]["count"] += 1

            resources.append(
                ResourceCost(
                    product_name=item.get("product_name", "Unknown"),
                    resource_name=item.get("resource_name", "Unknown"),
                    category=category,
                    cost=round(cost, 2),
                    unit=item.get("unit", "unknown"),
                    quantity=item.get("billed_quantity", "0"),
                )
            )

        # Build category list
        by_category = [
            CategoryCost(
                name=name,
                cost=round(info["cost"], 2),
                product_count=info["count"],
            )
            for name, info in sorted(categories.items(), key=lambda x: -x[1]["cost"])
        ]

        return CurrentCostsResponse(
            total_eur=round(total, 2),
            billing_period=billing_period or datetime.utcnow().strftime("%Y-%m"),
            by_category=by_category,
            resources=resources,
        )

    def get_cost_history(self, months: int = 12) -> CostHistoryResponse:
        """
        Get historical costs for the specified number of months.

        Args:
            months: Number of months to retrieve (default 12)

        Returns:
            CostHistoryResponse with monthly cost data
        """
        history: list[MonthCost] = []
        now = datetime.utcnow()

        for i in range(months):
            # Calculate month offset
            month = now.month - i
            year = now.year
            while month <= 0:
                month += 12
                year -= 1

            period = f"{year}-{month:02d}"

            # Get costs for this period
            costs = self.get_current_costs(billing_period=period)

            # Build category dict
            by_category = {cat.name: cat.cost for cat in costs.by_category}

            history.append(
                MonthCost(
                    period=period,
                    total=costs.total_eur,
                    by_category=by_category,
                )
            )

        # Reverse to get chronological order
        history.reverse()

        return CostHistoryResponse(history=history)

    def get_server_info(self, server_id: str) -> dict | None:
        """
        Get server information from Scaleway.

        Args:
            server_id: The server UUID

        Returns:
            Server info dict or None
        """
        return self._run_scw_command(["instance", "server", "get", server_id])

    def reboot_server(self, server_id: str) -> bool:
        """
        Reboot a server.

        Args:
            server_id: The server UUID

        Returns:
            True if command succeeded
        """
        result = self._run_scw_command(["instance", "server", "reboot", server_id])
        return result is not None


# Singleton instance
scaleway_service = ScalewayService()
