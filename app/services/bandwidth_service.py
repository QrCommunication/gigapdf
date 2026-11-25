"""Monthly S3 download accounting based on immutable bucket access logs."""

from __future__ import annotations

import logging
import shlex
from collections import defaultdict
from datetime import UTC, datetime

import boto3
from sqlalchemy import column, func, select, table
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.core.database import get_sync_session
from app.models.database import S3AccessLogFile, S3BandwidthMonth, S3BandwidthUserMonth, UserQuota
from app.storage_backends import get_storage_backend

logger = logging.getLogger(__name__)
auth_users = table("users", column("id"), column("email"), column("name"))
settings = get_settings()


class S3BandwidthService:
    def __init__(self):
        self._client = None

    def _get_client(self):
        if self._client is None:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.s3_access_log_endpoint,
                aws_access_key_id=settings.s3_access_log_access_key_id,
                aws_secret_access_key=settings.s3_access_log_secret_access_key,
                region_name=settings.s3_access_log_region,
            )
        return self._client

    @staticmethod
    def _download_entries(content: str):
        for line in content.splitlines():
            if not line.strip():
                continue
            try:
                fields = shlex.split(line)
                if len(fields) < 14 or fields[7] != "REST.GET.OBJECT":
                    continue
                if fields[10] not in {"200", "206"}:
                    continue
                bytes_sent = int(fields[12])
                if bytes_sent <= 0:
                    continue
                timestamp_text = f"{fields[2].lstrip('[')} {fields[3].rstrip(']')}"
                timestamp = datetime.strptime(timestamp_text, "%d/%b/%Y:%H:%M:%S %z")
                period = timestamp.astimezone(UTC).strftime("%Y-%m")
                key_parts = fields[8].split("/")
                user_id = (
                    key_parts[1]
                    if len(key_parts) > 2 and key_parts[0] in {"documents", "thumbnails"}
                    else None
                )
                yield period, user_id, bytes_sent
            except (ValueError, IndexError):
                logger.warning("Ignoring malformed S3 access-log line")

    @classmethod
    def parse_access_log(cls, content: str) -> dict[str, tuple[int, int]]:
        totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for period, _user_id, bytes_sent in cls._download_entries(content):
            totals[period][0] += bytes_sent
            totals[period][1] += 1
        return {period: (values[0], values[1]) for period, values in totals.items()}

    @classmethod
    def parse_user_access_log(cls, content: str) -> dict[tuple[str, str], int]:
        totals: dict[tuple[str, str], int] = defaultdict(int)
        for period, user_id, bytes_sent in cls._download_entries(content):
            if user_id:
                totals[(period, user_id)] += bytes_sent
        return dict(totals)

    @staticmethod
    def _upsert_month(session, period: str, *, downloaded=0, storage=None) -> None:
        values = {"period": period, "downloaded_bytes": downloaded}
        update = {"updated_at": func.now()}
        if downloaded:
            update["downloaded_bytes"] = S3BandwidthMonth.downloaded_bytes + downloaded
        if storage is not None:
            values["storage_bytes"] = storage
            update["storage_bytes"] = storage
        session.execute(
            insert(S3BandwidthMonth)
            .values(**values)
            .on_conflict_do_update(index_elements=["period"], set_=update)
        )

    @staticmethod
    def _upsert_user_month(session, period: str, user_id: str, downloaded: int) -> None:
        session.execute(
            insert(S3BandwidthUserMonth)
            .values(period=period, user_id=user_id, downloaded_bytes=downloaded)
            .on_conflict_do_update(
                constraint="uq_s3_bandwidth_user_period",
                set_={
                    "downloaded_bytes": S3BandwidthUserMonth.downloaded_bytes + downloaded,
                    "updated_at": func.now(),
                },
            )
        )

    def collect_access_logs(self) -> dict[str, int]:
        client = self._get_client()
        bucket = settings.s3_access_log_bucket
        prefix = settings.s3_access_log_prefix
        with get_sync_session() as session:
            processed = set(session.execute(select(S3AccessLogFile.object_key)).scalars())

        files_processed = 0
        bytes_recorded = 0
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key in processed:
                    continue
                body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
                content = body.decode("utf-8", errors="replace")
                totals = self.parse_access_log(content)
                user_totals = self.parse_user_access_log(content)
                with get_sync_session() as session:
                    for period, (download_bytes, _request_count) in totals.items():
                        self._upsert_month(session, period, downloaded=download_bytes)
                    for (period, user_id), download_bytes in user_totals.items():
                        self._upsert_user_month(session, period, user_id, download_bytes)
                    session.add(
                        S3AccessLogFile(
                            object_key=key,
                            downloaded_bytes=sum(values[0] for values in totals.values()),
                            request_count=sum(values[1] for values in totals.values()),
                        )
                    )
                processed.add(key)
                files_processed += 1
                bytes_recorded += sum(values[0] for values in totals.values())
        return {"files_processed": files_processed, "bytes_recorded": bytes_recorded}

    def refresh_storage(self) -> int:
        total_bytes = sum(obj.size for obj in get_storage_backend().iter_objects())
        period = datetime.now(UTC).strftime("%Y-%m")
        with get_sync_session() as session:
            self._upsert_month(session, period, storage=total_bytes)
        return total_bytes

    def get_cost_for_period(self, period: str) -> dict:
        with get_sync_session() as session:
            record = session.execute(
                select(S3BandwidthMonth).where(S3BandwidthMonth.period == period)
            ).scalar_one_or_none()

        storage_bytes = record.storage_bytes if record else 0
        downloaded_bytes = record.downloaded_bytes if record else 0
        free_bytes = storage_bytes * 3
        overage_bytes = max(0, downloaded_bytes - free_bytes)
        storage_tb_started = (
            (storage_bytes + 1_000_000_000_000 - 1) // 1_000_000_000_000
            if storage_bytes
            else 0
        )
        return {
            "period": period,
            "storage_bytes": storage_bytes,
            "downloaded_bytes": downloaded_bytes,
            "free_bandwidth_bytes": free_bytes,
            "bandwidth_overage_bytes": overage_bytes,
            "bandwidth_overage_usd": overage_bytes / 1_000_000_000 * 0.01,
            "storage_tb_started": storage_tb_started,
            "storage_cost_eur": storage_tb_started * 5.0,
            "hosting_cost_eur": 10.0,
        }

    def get_user_costs(self, period: str, user_id: str | None = None, limit: int = 10) -> list[dict]:
        downloaded = func.sum(S3BandwidthUserMonth.downloaded_bytes)
        query = (
            select(UserQuota, auth_users.c.email, auth_users.c.name, downloaded)
            .outerjoin(auth_users, auth_users.c.id == UserQuota.user_id)
            .outerjoin(
                S3BandwidthUserMonth,
                (S3BandwidthUserMonth.user_id == UserQuota.user_id)
                & (S3BandwidthUserMonth.period == period),
            )
            .group_by(UserQuota.id, UserQuota.user_id, auth_users.c.email, auth_users.c.name)
            .order_by(downloaded.desc().nullslast())
            .limit(limit)
        )
        if user_id:
            query = query.where(UserQuota.user_id == user_id)

        results = []
        with get_sync_session() as session:
            for quota, email, name, downloaded_bytes in session.execute(query):
                storage_bytes = quota.storage_used_bytes
                downloaded_bytes = downloaded_bytes or 0
                free_bytes = storage_bytes * 3
                overage_bytes = max(0, downloaded_bytes - free_bytes)
                storage_tb_started = (
                    (storage_bytes + 1_000_000_000_000 - 1) // 1_000_000_000_000
                    if storage_bytes
                    else 0
                )
                results.append(
                    {
                        "period": period,
                        "user_id": quota.user_id,
                        "email": email or quota.email,
                        "name": name,
                        "storage_bytes": storage_bytes,
                        "downloaded_bytes": downloaded_bytes,
                        "free_bandwidth_bytes": free_bytes,
                        "bandwidth_overage_usd": overage_bytes / 1_000_000_000 * 0.01,
                        "storage_tb_started": storage_tb_started,
                        "storage_cost_eur": storage_tb_started * 5.0,
                    }
                )
        return results


bandwidth_service = S3BandwidthService()


if __name__ == "__main__":
    print(bandwidth_service.collect_access_logs())
