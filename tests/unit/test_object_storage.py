"""
Unit tests for the pluggable object storage layer (app/storage_backends).

No network: S3 backends are exercised with a fake boto3 client, the local
backend on a temp directory.
"""

import os
from unittest.mock import MagicMock

import pytest

from app.config import Settings
from app.services.s3_service import ObjectStorageService
from app.storage_backends import (
    LocalFilesystemBackend,
    PresignNotSupportedError,
    S3BackendConfig,
    S3CompatibleBackend,
    StorageBackend,
    StorageConfigurationError,
    StorageError,
    available_storage_providers,
    create_storage_backend,
    get_storage_backend,
    register_storage_provider,
    set_storage_backend,
)
from app.storage_backends.migration import migrate_objects


@pytest.fixture(autouse=True)
def _isolated_storage_env(monkeypatch):
    """Keep the developer's storage configuration out of these tests.

    ``Settings`` reads environment variables (and ``.env``, disabled below):
    a local ``S3_ENDPOINT``/``S3_REGION`` would otherwise satisfy or override
    the very defaults the provider presets are tested on.
    """
    for name in list(os.environ):
        if name.upper().startswith(("S3_", "STORAGE_")):
            monkeypatch.delenv(name)


def _isolated_settings(**values) -> Settings:
    """``Settings`` built from *values* and defaults only — never ``.env``."""
    return Settings(_env_file=None, **values)


def _settings(**overrides) -> Settings:
    base = {
        "app_secret_key": "x" * 40,
        "s3_access_key_id": "AK",
        "s3_secret_access_key": "SK",
        "s3_bucket_name": "bucket",
    }
    base.update(overrides)
    return _isolated_settings(**base)


class _ClientError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


# ---------------------------------------------------------------------------
# Registry / provider presets
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_builtin_providers(self):
        assert {"idrive", "scaleway", "aws", "minio", "s3", "local"} <= set(
            available_storage_providers()
        )

    def test_default_provider_is_idrive(self):
        assert _isolated_settings(app_secret_key="x" * 40).storage_provider == "idrive"

    def test_idrive_requires_endpoint(self):
        with pytest.raises(StorageConfigurationError, match="S3_ENDPOINT"):
            create_storage_backend(_settings(storage_provider="idrive"))

    def test_idrive_with_endpoint(self):
        backend = create_storage_backend(
            _settings(
                storage_provider="idrive",
                s3_endpoint="https://abcd.par.idrivee2-12.com/",
            )
        )
        assert isinstance(backend, S3CompatibleBackend)
        info = backend.describe()
        assert info["provider"] == "idrive"
        assert info["endpoint"] == "https://abcd.par.idrivee2-12.com"
        assert info["server_side_encryption"] is False
        assert backend.config.addressing_style == "path"

    def test_scaleway_default_endpoint_from_region(self):
        backend = create_storage_backend(
            _settings(storage_provider="scaleway", s3_region="nl-ams")
        )
        assert backend.config.endpoint_url == "https://s3.nl-ams.scw.cloud"
        assert backend.config.region == "nl-ams"

    def test_aws_uses_sse_and_no_endpoint(self):
        backend = create_storage_backend(_settings(storage_provider="aws"))
        assert backend.config.endpoint_url is None
        assert backend.config.server_side_encryption is True

    def test_sse_override(self):
        backend = create_storage_backend(
            _settings(
                storage_provider="idrive",
                s3_endpoint="https://e2.example",
                s3_server_side_encryption=True,
            )
        )
        assert backend.config.server_side_encryption is True

    def test_provider_name_is_case_insensitive(self):
        backend = create_storage_backend(
            _settings(storage_provider="Scaleway")
        )
        assert backend.provider == "scaleway"

    def test_unknown_provider(self):
        with pytest.raises(StorageConfigurationError, match="Unknown storage provider"):
            create_storage_backend(_settings(storage_provider="nope"))

    def test_local_provider(self, tmp_path):
        backend = create_storage_backend(
            _settings(storage_provider="local", storage_local_root=tmp_path)
        )
        assert isinstance(backend, LocalFilesystemBackend)
        assert backend.root == tmp_path.resolve()

    def test_custom_dotted_path_provider(self, tmp_path):
        backend = create_storage_backend(
            _settings(storage_local_root=tmp_path),
            provider=f"{__name__}:custom_factory",
        )
        assert backend.provider == "custom"

    def test_registered_custom_provider(self, tmp_path):
        register_storage_provider("mine", custom_factory)
        backend = create_storage_backend(
            _settings(storage_provider="mine", storage_local_root=tmp_path)
        )
        assert backend.provider == "custom"

    def test_factory_must_return_backend(self):
        with pytest.raises(StorageConfigurationError, match="did not return"):
            create_storage_backend(_settings(), provider=f"{__name__}:bad_factory")

    def test_set_storage_backend_override(self, tmp_path):
        local = LocalFilesystemBackend(tmp_path)
        set_storage_backend(local)
        try:
            assert get_storage_backend() is local
        finally:
            set_storage_backend(None)


class _CustomBackend(LocalFilesystemBackend):
    provider = "custom"


def custom_factory(settings):
    return _CustomBackend(settings.storage_local_root)


def bad_factory(settings):
    return object()


# ---------------------------------------------------------------------------
# S3-compatible backend (fake client)
# ---------------------------------------------------------------------------


def _s3_backend(provider="idrive", **kw) -> tuple[S3CompatibleBackend, MagicMock]:
    config = S3BackendConfig.from_preset(
        provider,
        bucket="b",
        access_key_id="AK",
        secret_access_key="SK",
        endpoint_url=kw.pop("endpoint_url", "https://e2.example"),
        **kw,
    )
    client = MagicMock()
    return S3CompatibleBackend(config, client=client), client


class TestS3Backend:
    def test_put_without_sse(self):
        backend, client = _s3_backend()
        client.put_object.return_value = {"ETag": '"abc"'}
        result = backend.put_object("k", b"data", "application/pdf", {"n": 1})
        assert result == {"etag": "abc", "encryption": None}
        kwargs = client.put_object.call_args.kwargs
        assert "ServerSideEncryption" not in kwargs
        assert kwargs["Metadata"] == {"n": "1"}
        assert kwargs["Bucket"] == "b"

    def test_put_with_sse(self):
        backend, client = _s3_backend("aws", endpoint_url=None)
        client.put_object.return_value = {}
        backend.put_object("k", b"x")
        assert client.put_object.call_args.kwargs["ServerSideEncryption"] == "AES256"

    def test_get_missing_returns_none(self):
        backend, client = _s3_backend()
        client.get_object.side_effect = _ClientError("NoSuchKey")
        assert backend.get_object("k") is None

    def test_get_other_error_raises(self):
        backend, client = _s3_backend()
        client.get_object.side_effect = _ClientError("AccessDenied")
        with pytest.raises(_ClientError):
            backend.get_object("k")

    def test_head_missing(self):
        backend, client = _s3_backend()
        client.head_object.side_effect = _ClientError("404")
        assert backend.head_object("k") is None
        assert backend.object_exists("k") is False

    def test_copy_replaces_metadata_when_given(self):
        backend, client = _s3_backend()
        backend.copy_object("a", "b2", content_type="image/png")
        kwargs = client.copy_object.call_args.kwargs
        assert kwargs["MetadataDirective"] == "REPLACE"
        assert kwargs["CopySource"] == {"Bucket": "b", "Key": "a"}

    def test_presign_maps_method(self):
        backend, client = _s3_backend()
        client.generate_presigned_url.return_value = "https://signed"
        assert backend.presigned_url("k", 60, "put") == "https://signed"
        assert client.generate_presigned_url.call_args.args[0] == "put_object"

    def test_iter_objects_paginates(self):
        backend, client = _s3_backend()
        client.get_paginator.return_value.paginate.return_value = [
            {"Contents": [{"Key": "a", "Size": 1, "ETag": '"e"'}]},
            {"Contents": [{"Key": "b", "Size": 2}]},
            {},
        ]
        assert [o.key for o in backend.iter_objects()] == ["a", "b"]
        assert backend.list_objects(max_keys=1)[0].etag == "e"

    def test_missing_credentials(self):
        config = S3BackendConfig.from_preset(
            "scaleway", bucket="b", access_key_id="", secret_access_key=""
        )
        with pytest.raises(StorageConfigurationError):
            S3CompatibleBackend(config).client  # noqa: B018


# ---------------------------------------------------------------------------
# Local backend
# ---------------------------------------------------------------------------


class TestLocalBackend:
    def test_roundtrip(self, tmp_path):
        b = LocalFilesystemBackend(tmp_path)
        b.put_object("documents/u/d/v1.pdf", b"%PDF", "application/pdf", {"a": "1"})
        assert b.get_object("documents/u/d/v1.pdf") == b"%PDF"
        head = b.head_object("documents/u/d/v1.pdf")
        assert head.size == 4
        assert head.content_type == "application/pdf"
        assert head.metadata == {"a": "1"}
        assert [o.key for o in b.iter_objects("documents/")] == ["documents/u/d/v1.pdf"]

    def test_missing(self, tmp_path):
        b = LocalFilesystemBackend(tmp_path)
        assert b.get_object("nope") is None
        assert b.head_object("nope") is None
        b.delete_object("nope")  # no error

    def test_copy_and_delete(self, tmp_path):
        b = LocalFilesystemBackend(tmp_path)
        b.put_object("a", b"1", "text/plain")
        b.copy_object("a", "x/b")
        assert b.head_object("x/b").content_type == "text/plain"
        b.delete_object("a")
        assert b.get_object("a") is None
        assert b.get_object("x/b") == b"1"

    def test_rejects_path_traversal(self, tmp_path):
        b = LocalFilesystemBackend(tmp_path / "root")
        with pytest.raises(StorageError):
            b.put_object("../escape", b"x")

    def test_no_presign(self, tmp_path):
        with pytest.raises(PresignNotSupportedError):
            LocalFilesystemBackend(tmp_path).presigned_url("k")


# ---------------------------------------------------------------------------
# Facade (s3_service) on top of any backend
# ---------------------------------------------------------------------------


class TestFacade:
    def test_upload_download_delete(self, tmp_path):
        svc = ObjectStorageService(LocalFilesystemBackend(tmp_path, bucket="bk"))
        result = svc.upload_file(b"hello", "k/1.pdf")
        assert result["key"] == "k/1.pdf"
        assert result["bucket"] == "bk"
        assert result["size"] == 5
        assert svc.file_exists("k/1.pdf")
        assert svc.download_file("k/1.pdf") == b"hello"
        assert svc.list_files("k/")[0]["size"] == 5
        assert svc.delete_file("k/1.pdf") is True
        assert svc.download_file("k/1.pdf") is None

    def test_copy(self, tmp_path):
        svc = ObjectStorageService(LocalFilesystemBackend(tmp_path))
        svc.upload_file(b"x", "a")
        assert svc.copy_file("a", "b")["dest_key"] == "b"
        assert svc.download_file("b") == b"x"

    def test_presign_legacy_method_names(self):
        backend = MagicMock(spec=StorageBackend)
        backend.presigned_url.return_value = "u"
        svc = ObjectStorageService(backend)
        assert svc.get_presigned_url("k", expires_in=10, method="put_object") == "u"
        backend.presigned_url.assert_called_once_with("k", 10, "put")

    def test_delete_failure_returns_false(self):
        backend = MagicMock(spec=StorageBackend)
        backend.delete_object.side_effect = RuntimeError("boom")
        assert ObjectStorageService(backend).delete_file("k") is False

    def test_delete_prefix_removes_only_that_directory(self, tmp_path):
        svc = ObjectStorageService(LocalFilesystemBackend(tmp_path))
        svc.upload_file(b"1", "documents/u1/d/v1.pdf")
        svc.upload_file(b"2", "documents/u1/d/v2.pdf")
        svc.upload_file(b"3", "documents/u10/d/v1.pdf")  # shares the "u1" start

        assert svc.delete_prefix("documents/u1/") == 2
        assert svc.download_file("documents/u1/d/v1.pdf") is None
        assert svc.download_file("documents/u10/d/v1.pdf") == b"3"
        assert svc.delete_prefix("documents/u1/") == 0  # idempotent

    @pytest.mark.parametrize("prefix", ["", "/", "documents/u1"])
    def test_delete_prefix_refuses_unbounded_prefix(self, prefix):
        backend = MagicMock(spec=StorageBackend)
        with pytest.raises(ValueError):
            ObjectStorageService(backend).delete_prefix(prefix)
        backend.iter_objects.assert_not_called()

    def test_delete_keys_raises_instead_of_swallowing(self):
        backend = MagicMock(spec=StorageBackend)
        backend.delete_object.side_effect = RuntimeError("boom")
        with pytest.raises(RuntimeError):
            ObjectStorageService(backend).delete_keys(["k"])

    def test_key_layout_unchanged(self):
        svc = ObjectStorageService(MagicMock(spec=StorageBackend))
        assert svc.get_document_key("u", "d", 3) == "documents/u/d/v3.pdf"
        assert svc.get_thumbnail_key("u", "d", "png") == "thumbnails/u/d.png"


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


class TestMigration:
    def test_copies_and_is_idempotent(self, tmp_path):
        src = LocalFilesystemBackend(tmp_path / "src")
        dst = LocalFilesystemBackend(tmp_path / "dst")
        src.put_object("documents/a.pdf", b"AAA", "application/pdf", {"encrypted": "true"})
        src.put_object("thumbnails/a.png", b"PNG", "image/png")

        stats = migrate_objects(src, dst, workers=2)
        assert (stats.scanned, stats.copied, stats.skipped) == (2, 2, 0)
        assert stats.errors == []
        assert dst.get_object("documents/a.pdf") == b"AAA"
        head = dst.head_object("documents/a.pdf")
        assert head.content_type == "application/pdf"
        assert head.metadata == {"encrypted": "true"}

        again = migrate_objects(src, dst)
        assert (again.copied, again.skipped) == (0, 2)

    def test_dry_run_and_prefix(self, tmp_path):
        src = LocalFilesystemBackend(tmp_path / "src")
        dst = LocalFilesystemBackend(tmp_path / "dst")
        src.put_object("documents/a", b"1")
        src.put_object("thumbnails/b", b"2")

        stats = migrate_objects(src, dst, prefix="documents/", dry_run=True)
        assert stats.scanned == 1 and stats.copied == 0
        assert dst.get_object("documents/a") is None


class TestBucketEncryption:
    def test_enabled(self):
        backend, client = _s3_backend()
        client.get_bucket_encryption.return_value = {
            "ServerSideEncryptionConfiguration": {
                "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            }
        }
        assert backend.bucket_encryption() == "AES256"

    def test_disabled(self):
        backend, client = _s3_backend()
        client.get_bucket_encryption.side_effect = _ClientError(
            "ServerSideEncryptionConfigurationNotFoundError"
        )
        assert backend.bucket_encryption() == "disabled"

    def test_unknown_when_api_unsupported(self):
        backend, client = _s3_backend()
        client.get_bucket_encryption.side_effect = _ClientError("NotImplemented")
        assert backend.bucket_encryption() is None

    def test_idrive_does_not_send_per_request_sse(self):
        backend, client = _s3_backend("idrive")
        client.put_object.return_value = {}
        backend.put_object("k", b"x")
        assert "ServerSideEncryption" not in client.put_object.call_args.kwargs

    def test_local_backend_unknown(self, tmp_path):
        assert LocalFilesystemBackend(tmp_path).bucket_encryption() is None
