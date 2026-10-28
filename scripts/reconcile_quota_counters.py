#!/usr/bin/env python3
"""Recompute the storage quota counters from the stored documents.

Personal quotas (``user_quotas``) and organizations (``tenants``) keep running
``storage_used_bytes`` / ``document_count`` counters that only move by deltas:
a counter that drifted in the past (before counter moves were atomic and
attributed to a fixed counter — migration 024) stays wrong forever. This
command recounts each of them from the ACTIVE ``stored_documents`` and their
``quota_tenant_id`` attribution (NULL = the owner's personal quota):

* dry run (default): prints every drifting counter, changes nothing;
* ``--apply``: sets those counters to their recounted values, in one
  transaction.

Idempotent: once applied, a second run reports no drift. Exit code 0 on
success (with or without drift), 1 on failure.

Usage (on the server, from the checkout, with the prod env loaded):

    .venv/bin/python scripts/reconcile_quota_counters.py            # dry run
    .venv/bin/python scripts/reconcile_quota_counters.py --apply

Document writes are paused for the duration of the transaction (SHARE lock on
``stored_documents``; reads continue). It gives up after 5 s if the lock
cannot be taken — re-run it.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import TextIO

# Make ``app`` importable when invoked as a plain script.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.core.database import close_database, get_session_factory  # noqa: E402
from app.services.quota_reconciliation import reconcile_storage_counters  # noqa: E402


async def run(apply: bool, out: TextIO = sys.stdout) -> int:
    """Reconcile the counters; return the number of drifting counters found."""
    async with get_session_factory()() as session:
        try:
            drifts = await reconcile_storage_counters(session, apply=apply)
            if apply:
                await session.commit()
            else:
                await session.rollback()
        except BaseException:
            await session.rollback()
            raise

    mode = "applied" if apply else "dry run — nothing changed"
    print(f"{len(drifts)} drifting counter(s) ({mode})", file=out)
    for drift in drifts:
        print(f"  {drift.describe()}", file=out)
    if drifts and not apply:
        print("Re-run with --apply to correct them.", file=out)
    return len(drifts)


async def _run_and_close(apply: bool) -> None:
    try:
        await run(apply=apply)
    finally:
        await close_database()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the recounted values (default: dry run, print the drifts only)",
    )
    args = parser.parse_args(argv)
    try:
        asyncio.run(_run_and_close(apply=args.apply))
    except Exception as exc:  # noqa: BLE001 — reported, exit code says it
        print(f"reconciliation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
