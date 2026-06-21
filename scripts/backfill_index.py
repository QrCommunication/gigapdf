#!/usr/bin/env python3
"""Backfill the full-text + semantic index for legacy documents.

Documents uploaded *before* the client-side indexation circuit existed have no
``extracted_text`` and no ``ocr_blocks`` embeddings, so they are invisible to
both keyword and semantic search. This script re-indexes them by:

  1. resolving the target owner (by ``--email`` or ``--owner-id``);
  2. downloading each document's current version bytes from S3 (decrypting if
     the version is encrypted at rest);
  3. extracting the PDF text layer with the native WASM engine (Node helper
     ``apps/web/scripts/extract_pdf_text.mjs`` — the Python backend has no PDF
     parser);
  4. calling the production :func:`reindex_document_text`, which sets
     ``extracted_text`` (→ generated ``search_vector``) and (re)builds the
     ``ocr_blocks`` embeddings via fastembed.

It reuses the exact production indexing path, and ``reindex_document_text`` is a
REPLACE, so the script is **idempotent**: re-running yields the same state.

Usage (on the server, with the prod env loaded):

    venv/bin/python scripts/backfill_index.py --email user@example.com
    venv/bin/python scripts/backfill_index.py --owner-id <id> --all --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy import text as sql_text

from app.api.v1.storage import reindex_document_text
from app.core.database import get_session_factory
from app.models.database import DocumentVersion, StoredDocument
from app.services.s3_service import s3_service

_REPO_ROOT = Path(__file__).resolve().parent.parent
_WEB_DIR = _REPO_ROOT / "apps" / "web"
_NODE_SCRIPT = _WEB_DIR / "scripts" / "extract_pdf_text.mjs"


def _extract_text(pdf_bytes: bytes) -> str:
    """Run the WASM Node extractor on *pdf_bytes*; return the text layer.

    Raises RuntimeError with the extractor's stderr on failure so the caller can
    log it and skip the document (extraction must never silently yield ""+OK).
    """
    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        proc = subprocess.run(
            ["node", str(_NODE_SCRIPT), tmp.name],
            cwd=str(_WEB_DIR),  # so Node resolves the workspace dependency
            capture_output=True,
            text=True,
            timeout=180,
        )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"node exit {proc.returncode}")
    return proc.stdout


async def _resolve_owner_id(session, email: str) -> str | None:
    """Map a Better Auth account email to its ``users.id`` (= documents.owner_id)."""
    row = (
        await session.execute(
            sql_text("SELECT id FROM users WHERE lower(email) = lower(:e) LIMIT 1"),
            {"e": email},
        )
    ).first()
    return row[0] if row else None


def _download_bytes(owner_id: str, doc: StoredDocument, version: DocumentVersion) -> bytes:
    """Fetch the current version bytes from S3, decrypting if needed."""
    key = version.file_path  # the actual stored S3 key for this version
    if version.is_encrypted and version.encryption_key:
        return s3_service.download_encrypted_document(
            key=key,
            encrypted_dek=version.encryption_key,
            document_id=doc.id,
            user_id=owner_id,
        )
    return s3_service.download_file(key)


async def run(args: argparse.Namespace) -> int:
    factory = get_session_factory()

    async with factory() as session:
        owner_id = args.owner_id
        if not owner_id:
            owner_id = await _resolve_owner_id(session, args.email)
            if not owner_id:
                print(f"✗ No user found for email {args.email!r}", file=sys.stderr)
                return 1
        print(f"Owner: {owner_id}")

        query = select(StoredDocument).where(
            StoredDocument.owner_id == owner_id,
            StoredDocument.is_deleted.is_(False),
        )
        if not args.all:
            # Only documents missing a text index.
            query = query.where(
                (StoredDocument.extracted_text.is_(None))
                | (StoredDocument.extracted_text == "")
            )
        query = query.order_by(StoredDocument.created_at.desc())
        if args.limit:
            query = query.limit(args.limit)

        docs = list((await session.execute(query)).scalars().all())

    print(f"Documents to process: {len(docs)}{' (DRY RUN)' if args.dry_run else ''}\n")

    indexed = skipped = failed = total_blocks = 0

    for doc in docs:
        label = f"{doc.id}  {(doc.name or '')[:40]}"
        try:
            async with factory() as session:
                version = (
                    await session.execute(
                        select(DocumentVersion).where(
                            DocumentVersion.document_id == doc.id,
                            DocumentVersion.version_number == doc.current_version,
                        )
                    )
                ).scalar_one_or_none()
                if version is None:
                    print(f"  ⚠ {label} — no version {doc.current_version}, skip")
                    skipped += 1
                    continue

                pdf_bytes = _download_bytes(owner_id, doc, version)
                if not pdf_bytes:
                    print(f"  ⚠ {label} — empty/missing S3 object, skip")
                    skipped += 1
                    continue

                text = _extract_text(pdf_bytes)
                chars = len(text.strip())

                if args.dry_run:
                    print(f"  · {label} — {len(pdf_bytes)}B → {chars} chars (dry-run)")
                    skipped += 1
                    continue

                blocks = await reindex_document_text(session, doc.id, text)
                await session.commit()
                total_blocks += blocks
                indexed += 1
                print(f"  ✓ {label} — {chars} chars, {blocks} blocks")
        except Exception as exc:  # noqa: BLE001 — one bad doc must not abort the run
            failed += 1
            print(f"  ✗ {label} — {type(exc).__name__}: {exc}", file=sys.stderr)

    print(
        f"\nDone. indexed={indexed} skipped={skipped} failed={failed} "
        f"semantic_blocks={total_blocks}"
    )
    return 0 if failed == 0 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill document text + embeddings index.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--email", help="Owner email (resolved to users.id).")
    target.add_argument("--owner-id", help="Owner id (documents.owner_id) directly.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Reindex every active doc, not only those missing a text index.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Cap the number of documents.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract + report char counts without writing the index.",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
