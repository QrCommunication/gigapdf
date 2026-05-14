# HAUT-BACK-07 Fix: Global Celery Signal Coverage

## Problem
The Celery `task_postrun` and `task_failure` signals were only monitoring **export tasks**, leaving these critical tasks unwatched:
- `app.tasks.ocr_tasks.process_ocr` (OCR processing)
- `app.tasks.processing_tasks.merge_documents` (merge operations)
- `app.tasks.processing_tasks.split_document` (split operations)
- All billing tasks (`billing.*`)
- All infrastructure tasks (`infra.*`)

Result: Jobs stuck in PENDING state indefinitely (no database status update).

---

## Solution

### 1. Global Signal Handlers (`/app/tasks/celery_app.py`)

**Changed:** `task_postrun` and `task_failure` signal handlers

**Before:**
```python
@task_postrun.connect
def task_postrun_handler(task_id, task, retval, state, **kwargs):
    # Only handle export tasks
    if task.name and task.name.startswith("app.tasks.export_tasks"):
        _run_async(_update_job_completed(task_id, retval or {}, state))
```

**After:**
```python
@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, retval=None, state=None, **kwargs):
    # Global coverage: handle all application tasks
    tracked_prefixes = (
        "app.tasks.export_tasks.",    # Export operations
        "app.tasks.ocr_tasks.",       # OCR processing
        "app.tasks.processing_tasks.", # Merge, split
        "billing.",                    # Billing operations
        "infra.",                      # Infrastructure tasks
    )
    
    if any(task_name.startswith(prefix) for prefix in tracked_prefixes):
        _run_async(_update_job_completed(task_id, retval or {}, state))
```

### 2. Watchdog Task for Stuck Jobs (`/app/tasks/infra_tasks.py`)

**Added:** New periodic task `infra.watchdog_pending_tasks` (runs every 10 minutes)

Purpose: Detect and recover jobs stuck in PENDING/PROCESSING state for > 1 hour.

**Rules:**
- Task name: `infra.watchdog_pending_tasks`
- Schedule: Every 10 minutes (600 seconds)
- Timeout: 1 hour (configurable via `timeout_hours` kwarg)
- Action: Marks stuck jobs as `failed` with error message

**Recovery Flow:**
```
Job.status IN ('pending', 'processing')
  AND Job.created_at < (now - 1 hour)
  AND Job.celery_task_id IS NOT NULL
→ Mark as failed
→ Set error_message: "Task stuck in pending state for 1+ hours. Marked as failed by watchdog."
→ Set completed_at: current timestamp
```

### 3. Beat Schedule Update (`/app/tasks/celery_app.py`)

**Added:** Watchdog task to Celery Beat schedule:
```python
# Watchdog for stuck/pending tasks (checks every 10 minutes)
"watchdog-pending-tasks": {
    "task": "infra.watchdog_pending_tasks",
    "schedule": 600.0,  # Every 10 minutes
    "kwargs": {"timeout_hours": 1},
},
```

---

## Tasks Now Tracked

### Previously Unwatched ✗ → Now Tracked ✓

| Task Name | Category | Status Handler | Failure Handler | Watchdog |
|-----------|----------|-----------------|-----------------|-----------|
| `app.tasks.ocr_tasks.process_ocr` | OCR | ✓ NEW | ✓ NEW | ✓ YES |
| `app.tasks.processing_tasks.merge_documents` | Processing | ✓ NEW | ✓ NEW | ✓ YES |
| `app.tasks.processing_tasks.split_document` | Processing | ✓ NEW | ✓ NEW | ✓ YES |
| `billing.*` (all) | Billing | ✓ NEW | ✓ NEW | ✓ YES |
| `infra.*` (all) | Infrastructure | ✓ NEW | ✓ NEW | ✓ YES |
| `app.tasks.export_tasks.*` | Export | ✓ EXISTING | ✓ EXISTING | ✓ YES |

### Coverage Summary

**Before:** 1 task family (export_tasks)
**After:** 5 task families (export_tasks, ocr_tasks, processing_tasks, billing, infra)

---

## Database Schema Requirements

The solution relies on the existing `AsyncJob` table with columns:
- `celery_task_id` (string, unique)
- `status` (enum: 'pending', 'processing', 'completed', 'failed')
- `progress` (float, 0-100)
- `completed_at` (datetime, nullable)
- `error_message` (text, nullable)
- `result` (JSON, nullable)
- `created_at` (datetime, required)

✓ No schema changes required.

---

## Deployment Steps

1. **Backup database** (recommended)
2. **Deploy code changes:**
   - `/app/tasks/celery_app.py` (signal handlers + beat schedule)
   - `/app/tasks/infra_tasks.py` (watchdog task)
3. **Restart Celery workers** (existing connections will drop)
   ```bash
   # Graceful restart
   pkill -TERM -f "celery worker"
   # Wait for graceful shutdown (60s timeout)
   sleep 65
   # Start new workers
   celery -A app.tasks.celery_app worker -l info
   ```
4. **Restart Celery Beat** (scheduler for periodic tasks)
   ```bash
   pkill -TERM -f "celery beat"
   sleep 5
   celery -A app.tasks.celery_app beat -l info
   ```

---

## Verification

### Check Signal Handlers
```python
from app.tasks.celery_app import celery_app, task_postrun, task_failure

# Should show 3 handler connections
print(task_postrun.receivers)  # [task_postrun_handler, ...]
print(task_failure.receivers)  # [task_failure_handler, ...]
```

### Check Beat Schedule
```bash
celery -A app.tasks.celery_app inspect scheduled
# Should include "watchdog-pending-tasks" task
```

### Monitor Stuck Jobs
```python
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from sqlalchemy import select
from datetime import datetime, timedelta

with get_sync_session() as session:
    threshold = datetime.utcnow() - timedelta(hours=1)
    stuck = session.execute(
        select(AsyncJob).where(
            AsyncJob.celery_task_id != None,
            AsyncJob.status.in_(["pending", "processing"]),
            AsyncJob.created_at < threshold
        )
    ).scalars().all()
    print(f"Stuck jobs: {len(stuck)}")
```

---

## Configuration Tuning

### Watchdog Timeout
Default: 1 hour (`timeout_hours=1`)

To change, update beat schedule in `celery_app.py`:
```python
"kwargs": {"timeout_hours": 2},  # 2 hours instead
```

### Watchdog Frequency
Default: Every 10 minutes (`600.0` seconds)

To check more frequently (e.g., every 5 minutes):
```python
"schedule": 300.0,  # 5 minutes
```

---

## Testing Checklist

- [ ] Deploy code without errors
- [ ] Celery workers start successfully
- [ ] Celery Beat starts and schedules watchdog task
- [ ] Submit test OCR job → verify `AsyncJob.status` updates to 'completed'
- [ ] Submit test merge/split job → verify status updates
- [ ] Manually create stuck job in DB (status='pending', created_at > 1h ago)
- [ ] Wait for next watchdog run (< 10 min) → job marked as 'failed'
- [ ] Check logs: `"Watchdog recovered X stuck tasks"`
- [ ] Verify signal handlers log task completion: `"Task {name} ({id}) completed"`

---

## Files Modified

1. `/app/tasks/celery_app.py`
   - Updated `task_postrun_handler()` (lines 197-225)
   - Updated `task_failure_handler()` (lines 228-244)
   - Added watchdog to beat schedule (lines 112-118)

2. `/app/tasks/infra_tasks.py`
   - Added import: `AsyncJob` (line 13)
   - Added new function: `watchdog_pending_tasks()` (lines 122-189)

---

## Rollback Plan

If issues arise, rollback signal handlers to export-only mode:

```python
@task_postrun.connect
def task_postrun_handler(task_id, task, retval, state, **kwargs):
    if task.name and task.name.startswith("app.tasks.export_tasks"):
        _run_async(_update_job_completed(task_id, retval or {}, state))
```

And remove watchdog from beat schedule.
