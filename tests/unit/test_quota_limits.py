"""
Unit tests for plan limit resolution — plans/quotas harmonization (2026-06-13).

Guards the three sources of truth against re-divergence:
- ``app.services.quota_service.PLANS`` (backend limits)
- ``apps/admin/scripts/seed-plans.ts`` (DB seed — mirrored by the literals here)
- ``UserQuota`` ORM column defaults (``app.models.database``)

Also pins the ``-1 == unlimited`` semantics used by every quota check
(enterprise plan: unlimited storage / API calls / documents).
"""

from app.models.database import UserQuota
from app.services.quota_service import (
    PLANS,
    UNLIMITED,
    EffectiveLimits,
    has_capacity,
    is_unlimited,
    remaining_amount,
    usage_percentage,
)

GB = 1024 * 1024 * 1024


class TestPlanConfigurationsMatchSeed:
    """PLANS dict must mirror apps/admin/scripts/seed-plans.ts exactly."""

    def test_free_plan_limits_match_seed(self):
        assert PLANS["free"]["storage_limit_bytes"] == 5 * GB
        assert PLANS["free"]["api_calls_limit"] == 1000
        assert PLANS["free"]["document_limit"] == 1000

    def test_starter_plan_limits_match_seed(self):
        assert PLANS["starter"]["storage_limit_bytes"] == 25 * GB
        assert PLANS["starter"]["api_calls_limit"] == 10000
        assert PLANS["starter"]["document_limit"] == 5000

    def test_pro_plan_limits_match_seed(self):
        assert PLANS["pro"]["storage_limit_bytes"] == 100 * GB
        assert PLANS["pro"]["api_calls_limit"] == 100000
        # pro documents are now unlimited (-1), like enterprise — mirrors
        # the seed (apps/admin/scripts/seed-plans.ts) and landing pricing.
        assert PLANS["pro"]["document_limit"] == UNLIMITED

    def test_enterprise_plan_is_unlimited_on_all_axes(self):
        """Enterprise = unlimited (-1) everywhere, like the seed and landing.

        Regression guard: this used to be hardcoded 500GB / 1M calls while
        the seed said -1 — the divergence fixed by the 2026-06-13
        harmonization.
        """
        assert PLANS["enterprise"]["storage_limit_bytes"] == UNLIMITED
        assert PLANS["enterprise"]["api_calls_limit"] == UNLIMITED
        assert PLANS["enterprise"]["document_limit"] == UNLIMITED


class TestUserQuotaModelDefaultsMatchFreePlan:
    """ORM column defaults must equal the free plan (new users start free)."""

    @staticmethod
    def _column_default(name: str):
        return UserQuota.__table__.c[name].default.arg

    def test_document_limit_default_is_free_plan_value(self):
        """Regression guard: ORM default must equal the free-plan limit
        (raised from 100 to 1000 in migration 021_free_doc_1000)."""
        assert self._column_default("document_limit") == PLANS["free"]["document_limit"]
        assert self._column_default("document_limit") == 1000

    def test_storage_limit_default_is_free_plan_value(self):
        assert (
            self._column_default("storage_limit_bytes")
            == PLANS["free"]["storage_limit_bytes"]
        )

    def test_api_calls_limit_default_is_free_plan_value(self):
        assert self._column_default("api_calls_limit") == PLANS["free"]["api_calls_limit"]


class TestUnlimitedSentinelHelpers:
    """-1 must be treated as unlimited by every quota decision helper."""

    def test_is_unlimited(self):
        assert is_unlimited(UNLIMITED) is True
        assert is_unlimited(-1) is True
        assert is_unlimited(0) is False
        assert is_unlimited(100) is False

    def test_has_capacity_unlimited_always_allows(self):
        assert has_capacity(0, UNLIMITED) is True
        assert has_capacity(10**15, UNLIMITED, additional=10**15) is True
        assert has_capacity(999_999_999, UNLIMITED, additional=1) is True

    def test_has_capacity_bounded_limits(self):
        assert has_capacity(50, 100, additional=50) is True  # exactly at limit
        assert has_capacity(50, 100, additional=51) is False  # over limit
        assert has_capacity(100, 100, additional=1) is False  # count-style: full
        assert has_capacity(99, 100, additional=1) is True  # count-style: one left

    def test_remaining_amount(self):
        assert remaining_amount(0, UNLIMITED) == UNLIMITED
        assert remaining_amount(10**12, UNLIMITED) == UNLIMITED
        assert remaining_amount(30, 100) == 70
        assert remaining_amount(150, 100) == 0  # never negative when bounded

    def test_usage_percentage(self):
        assert usage_percentage(10**12, UNLIMITED) == 0.0  # never negative
        assert usage_percentage(50, 0) == 0.0  # unset limit
        assert usage_percentage(50, 100) == 50.0


class TestEffectiveLimitsEnterpriseResolution:
    """EffectiveLimits with -1 limits (enterprise) must report unlimited."""

    @staticmethod
    def _enterprise_limits(**overrides) -> EffectiveLimits:
        defaults = dict(
            storage_limit_bytes=UNLIMITED,
            storage_used_bytes=750 * GB,
            api_calls_limit=UNLIMITED,
            api_calls_used=2_000_000,
            document_limit=UNLIMITED,
            document_count=50_000,
            plan_type="enterprise",
            is_tenant_based=True,
            tenant_id="tenant-1",
            tenant_name="Acme",
            tenant_role="owner",
        )
        defaults.update(overrides)
        return EffectiveLimits(**defaults)

    def test_available_and_remaining_report_unlimited(self):
        limits = self._enterprise_limits()
        assert limits.storage_available_bytes == UNLIMITED
        assert limits.api_calls_remaining == UNLIMITED

    def test_percentages_are_zero_not_negative(self):
        limits = self._enterprise_limits()
        assert limits.storage_percentage == 0.0
        assert limits.api_percentage == 0.0

    def test_to_dict_propagates_unlimited_sentinels(self):
        payload = self._enterprise_limits().to_dict()
        assert payload["storage"]["limit_bytes"] == UNLIMITED
        assert payload["storage"]["available_bytes"] == UNLIMITED
        assert payload["storage"]["usage_percentage"] == 0.0
        assert payload["api_calls"]["limit"] == UNLIMITED
        assert payload["api_calls"]["remaining"] == UNLIMITED
        assert payload["api_calls"]["usage_percentage"] == 0.0
        assert payload["documents"]["limit"] == UNLIMITED

    def test_bounded_limits_still_compute_normally(self):
        limits = self._enterprise_limits(
            storage_limit_bytes=100 * GB,
            storage_used_bytes=25 * GB,
            api_calls_limit=1000,
            api_calls_used=250,
        )
        assert limits.storage_available_bytes == 75 * GB
        assert limits.api_calls_remaining == 750
        assert limits.storage_percentage == 25.0
        assert limits.api_percentage == 25.0
