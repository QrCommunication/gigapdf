"""Backup history and on-demand backup operations."""

import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import BackupRun

router = APIRouter()


class BackupRunResponse(BaseModel):
    id: int
    run_type: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    filename: str | None
    size_bytes: int | None
    destination: str | None
    details: str | None


@router.get("/runs", response_model=list[BackupRunResponse])
async def list_backup_runs(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BackupRun).order_by(BackupRun.started_at.desc()).limit(limit)
    )
    return result.scalars().all()


def _start_unit(unit: str) -> dict:
    result = subprocess.run(
        ["sudo", "systemctl", "start", unit],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        return {"success": False, "message": result.stderr.strip() or "Unable to start operation"}
    return {"success": True, "message": f"{unit} started"}


@router.post("/run")
async def run_backup():
    return _start_unit("gigapdf-backup.service")


@router.post("/test")
async def run_restore_test():
    return _start_unit("gigapdf-restore-test.service")
