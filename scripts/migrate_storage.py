#!/usr/bin/env python3
"""Copy every stored object from one storage provider to another.

Typical use: move from Scaleway Object Storage to iDrive e2 before switching
``STORAGE_PROVIDER``. Keys, bytes, content type and metadata are kept, so the
database needs no change. The copy is idempotent (objects already present with
the same size are skipped) and can be re-run until the switch.

Each side is configured from the normal app settings, overridden by
``MIGRATE_SRC_*`` / ``MIGRATE_DST_*`` environment variables:

    PROVIDER, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET_NAME, ENDPOINT, REGION,
    ADDRESSING_STYLE, LOCAL_ROOT

Example (Scaleway → iDrive e2):

    MIGRATE_SRC_PROVIDER=scaleway \\
    MIGRATE_SRC_ACCESS_KEY_ID=SCW... MIGRATE_SRC_SECRET_ACCESS_KEY=... \\
    MIGRATE_SRC_BUCKET_NAME=gigapdf MIGRATE_SRC_REGION=fr-par \\
    MIGRATE_DST_PROVIDER=idrive \\
    MIGRATE_DST_ACCESS_KEY_ID=... MIGRATE_DST_SECRET_ACCESS_KEY=... \\
    MIGRATE_DST_BUCKET_NAME=gigapdf \\
    MIGRATE_DST_ENDPOINT=https://xxxx.par.idrivee2-NN.com \\
    venv/bin/python scripts/migrate_storage.py --dry-run
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.config import Settings, get_settings  # noqa: E402
from app.storage_backends import create_storage_backend  # noqa: E402
from app.storage_backends.migration import MigrationStats, migrate_objects  # noqa: E402

_FIELDS = {
    "PROVIDER": "storage_provider",
    "ACCESS_KEY_ID": "s3_access_key_id",
    "SECRET_ACCESS_KEY": "s3_secret_access_key",
    "BUCKET_NAME": "s3_bucket_name",
    "ENDPOINT": "s3_endpoint",
    "REGION": "s3_region",
    "ADDRESSING_STYLE": "s3_addressing_style",
    "LOCAL_ROOT": "storage_local_root",
}


def settings_for(side: str) -> Settings:
    """App settings overridden by MIGRATE_{side}_* variables."""
    update = {}
    for suffix, attr in _FIELDS.items():
        value = os.environ.get(f"MIGRATE_{side}_{suffix}")
        if value is not None:
            update[attr] = Path(value) if attr == "storage_local_root" else value
    return get_settings().model_copy(update=update)


def _progress(stats: MigrationStats) -> None:
    print(
        f"  scanned={stats.scanned} copied={stats.copied} skipped={stats.skipped} "
        f"errors={len(stats.errors)} bytes={stats.bytes_copied}",
        flush=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--prefix", default="", help="Only copy keys under this prefix")
    parser.add_argument("--dry-run", action="store_true", help="List, do not copy")
    parser.add_argument("--overwrite", action="store_true", help="Re-copy existing objects")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    source = create_storage_backend(settings_for("SRC"))
    dest = create_storage_backend(settings_for("DST"))
    print(f"Source:      {source.describe()}")
    print(f"Destination: {dest.describe()}")
    source.check_connection()
    if not args.dry_run:
        dest.check_connection()

    stats = migrate_objects(
        source,
        dest,
        args.prefix,
        dry_run=args.dry_run,
        overwrite=args.overwrite,
        workers=args.workers,
        on_progress=_progress,
    )
    for err in stats.errors[:50]:
        print(f"  ERROR {err}", file=sys.stderr)
    print("Dry run — nothing copied." if args.dry_run else "Done.")
    return 1 if stats.errors else 0


if __name__ == "__main__":
    sys.exit(main())
