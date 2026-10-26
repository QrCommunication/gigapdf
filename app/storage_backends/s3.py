"""
Generic S3-compatible backend (boto3).

One implementation serves every provider speaking the S3 API. Provider
differences (default endpoint/region, addressing style, SSE support,
checksum quirks) live in :data:`S3_PROVIDER_PRESETS`, so adding a new
S3-compatible service is usually a single dict entry.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from app.storage_backends.base import (
    ObjectHead,
    PresignMethod,
    StorageBackend,
    StorageConfigurationError,
    StoredObject,
)

logger = logging.getLogger(__name__)

_NOT_FOUND_CODES = {"404", "NoSuchKey", "NotFound", "NoSuchObject"}


@dataclass(frozen=True)
class S3ProviderPreset:
    """Defaults for one S3-compatible provider."""

    label: str
    # ``{region}`` is substituted. None means "no default — S3_ENDPOINT required"
    # (or, for AWS, "let boto3 resolve it").
    endpoint_template: str | None
    default_region: str
    endpoint_required: bool = False
    addressing_style: str = "path"
    # Send ``ServerSideEncryption: AES256`` on every write. Off for providers
    # where encryption is enabled once as the bucket's default encryption
    # (iDrive e2, Scaleway): the provider then encrypts every object itself.
    # Documents are encrypted at application level (AES-256-GCM) anyway.
    server_side_encryption: bool = False
    # Third-party S3 implementations often reject the CRC checksums that
    # botocore >= 1.36 sends by default; only compute them when required.
    relaxed_checksums: bool = True


S3_PROVIDER_PRESETS: dict[str, S3ProviderPreset] = {
    # iDrive e2 — endpoint is account/region specific and shown in the e2
    # console (e.g. https://xxxx.par.idrivee2-NN.com). Any region code is
    # accepted for SigV4; use the one displayed next to the endpoint.
    # Encryption at rest is enabled on the bucket (default encryption), not
    # per request.
    "idrive": S3ProviderPreset(
        label="iDrive e2",
        endpoint_template=None,
        default_region="us-east-1",
        endpoint_required=True,
    ),
    "scaleway": S3ProviderPreset(
        label="Scaleway Object Storage",
        endpoint_template="https://s3.{region}.scw.cloud",
        default_region="fr-par",
    ),
    "aws": S3ProviderPreset(
        label="Amazon S3",
        endpoint_template=None,
        default_region="us-east-1",
        addressing_style="virtual",
        server_side_encryption=True,
        relaxed_checksums=False,
    ),
    "minio": S3ProviderPreset(
        label="MinIO",
        endpoint_template=None,
        default_region="us-east-1",
        endpoint_required=True,
    ),
    "s3": S3ProviderPreset(
        label="S3-compatible",
        endpoint_template=None,
        default_region="us-east-1",
        endpoint_required=True,
    ),
}


@dataclass(frozen=True)
class S3BackendConfig:
    """Fully resolved configuration of an :class:`S3CompatibleBackend`."""

    provider: str
    label: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    endpoint_url: str | None
    region: str
    addressing_style: str = "path"
    server_side_encryption: bool = False
    relaxed_checksums: bool = True

    @classmethod
    def from_preset(
        cls,
        provider: str,
        *,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        endpoint_url: str | None = None,
        region: str | None = None,
        addressing_style: str | None = None,
        server_side_encryption: bool | None = None,
    ) -> S3BackendConfig:
        preset = S3_PROVIDER_PRESETS[provider]
        region = region or preset.default_region
        endpoint = endpoint_url or (
            preset.endpoint_template.format(region=region)
            if preset.endpoint_template
            else None
        )
        if preset.endpoint_required and not endpoint:
            raise StorageConfigurationError(
                f"S3_ENDPOINT is required for storage provider '{provider}' "
                f"({preset.label})"
            )
        return cls(
            provider=provider,
            label=preset.label,
            bucket=bucket,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            endpoint_url=endpoint.rstrip("/") if endpoint else None,
            region=region,
            addressing_style=addressing_style or preset.addressing_style,
            server_side_encryption=(
                preset.server_side_encryption
                if server_side_encryption is None
                else server_side_encryption
            ),
            relaxed_checksums=preset.relaxed_checksums,
        )


class S3CompatibleBackend(StorageBackend):
    """:class:`StorageBackend` on top of any S3-compatible API."""

    def __init__(self, config: S3BackendConfig, client: Any | None = None):
        self.config = config
        self.provider = config.provider
        self.bucket = config.bucket
        self._client = client
        self._lock = threading.Lock()

    # -- client -------------------------------------------------------------

    @property
    def client(self) -> Any:
        """Lazily built boto3 client (credentials are checked on first use)."""
        if self._client is None:
            with self._lock:
                if self._client is None:
                    self._client = self._build_client()
        return self._client

    def _build_client(self) -> Any:
        if not (self.config.access_key_id and self.config.secret_access_key):
            raise StorageConfigurationError(
                "Object storage credentials missing — set S3_ACCESS_KEY_ID "
                "and S3_SECRET_ACCESS_KEY"
            )

        import boto3
        from botocore.config import Config

        options: dict[str, Any] = {
            "signature_version": "s3v4",
            "s3": {"addressing_style": self.config.addressing_style},
            "retries": {"max_attempts": 3, "mode": "standard"},
        }
        if self.config.relaxed_checksums:
            options["request_checksum_calculation"] = "when_required"
            options["response_checksum_validation"] = "when_required"
        try:
            boto_config = Config(**options)
        except TypeError:  # botocore < 1.36 has no checksum options
            options.pop("request_checksum_calculation", None)
            options.pop("response_checksum_validation", None)
            boto_config = Config(**options)

        client = boto3.client(
            "s3",
            endpoint_url=self.config.endpoint_url,
            region_name=self.config.region,
            aws_access_key_id=self.config.access_key_id,
            aws_secret_access_key=self.config.secret_access_key,
            config=boto_config,
        )
        logger.info(
            "Object storage ready: %s bucket=%s endpoint=%s",
            self.config.label,
            self.bucket,
            self.config.endpoint_url or "(aws default)",
        )
        return client

    @staticmethod
    def _is_not_found(exc: Exception) -> bool:
        response = getattr(exc, "response", None) or {}
        code = str(response.get("Error", {}).get("Code", ""))
        return code in _NOT_FOUND_CODES

    # -- writes -------------------------------------------------------------

    def put_object(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> dict:
        extra: dict[str, Any] = {"ContentType": content_type}
        if self.config.server_side_encryption:
            extra["ServerSideEncryption"] = "AES256"
        if metadata:
            extra["Metadata"] = {k: str(v) for k, v in metadata.items()}
        response = self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)
        return {
            "etag": response.get("ETag", "").strip('"'),
            "encryption": "AES256" if self.config.server_side_encryption else None,
        }

    def delete_object(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def copy_object(
        self,
        source_key: str,
        dest_key: str,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        extra: dict[str, Any] = {}
        if content_type or metadata:
            extra["MetadataDirective"] = "REPLACE"
            if content_type:
                extra["ContentType"] = content_type
            if metadata:
                extra["Metadata"] = {k: str(v) for k, v in metadata.items()}
        if self.config.server_side_encryption:
            extra["ServerSideEncryption"] = "AES256"
        self.client.copy_object(
            Bucket=self.bucket,
            Key=dest_key,
            CopySource={"Bucket": self.bucket, "Key": source_key},
            **extra,
        )

    # -- reads --------------------------------------------------------------

    def get_object(self, key: str) -> bytes | None:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if self._is_not_found(exc):
                return None
            raise
        return response["Body"].read()

    def head_object(self, key: str) -> ObjectHead | None:
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if self._is_not_found(exc):
                return None
            raise
        return ObjectHead(
            key=key,
            size=int(response.get("ContentLength", 0)),
            content_type=response.get("ContentType"),
            metadata=dict(response.get("Metadata") or {}),
        )

    def iter_objects(self, prefix: str = "") -> Iterator[StoredObject]:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield StoredObject(
                    key=obj["Key"],
                    size=int(obj.get("Size", 0)),
                    last_modified=obj.get("LastModified"),
                    etag=str(obj.get("ETag", "")).strip('"'),
                )

    # -- URLs ---------------------------------------------------------------

    def presigned_url(
        self, key: str, expires_in: int = 3600, method: PresignMethod = "get"
    ) -> str:
        operation = {"get": "get_object", "put": "put_object"}[method]
        return self.client.generate_presigned_url(
            operation,
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def public_url(self, key: str) -> str:
        if self.config.endpoint_url:
            return f"{self.config.endpoint_url}/{self.bucket}/{key}"
        return f"https://{self.bucket}.s3.{self.config.region}.amazonaws.com/{key}"

    # -- health -------------------------------------------------------------

    def check_connection(self) -> None:
        self.client.head_bucket(Bucket=self.bucket)

    def bucket_encryption(self) -> str | None:
        try:
            response = self.client.get_bucket_encryption(Bucket=self.bucket)
        except Exception as exc:
            response_err = getattr(exc, "response", None) or {}
            code = str(response_err.get("Error", {}).get("Code", ""))
            if code == "ServerSideEncryptionConfigurationNotFoundError":
                return "disabled"
            # Provider without this API, or missing permission.
            logger.info("Bucket encryption status unavailable: %s", exc)
            return None
        rules = response.get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
        for rule in rules:
            algo = rule.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm")
            if algo:
                return str(algo)
        return "disabled"

    def describe(self) -> dict:
        return {
            "provider": self.provider,
            "provider_label": self.config.label,
            "bucket": self.bucket,
            "endpoint": self.config.endpoint_url,
            "region": self.config.region,
            "server_side_encryption": self.config.server_side_encryption,
        }
