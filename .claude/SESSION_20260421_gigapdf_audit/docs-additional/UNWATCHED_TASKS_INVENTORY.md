# HAUT-BACK-07: Unwatched Tasks Inventory

## Summary
This document lists all Celery tasks that were previously unwatched (not covered by signal handlers) and are now fixed by the global signal coverage update.

---

## Tasks Previously Unwatched ✗ → Now Tracked ✓

### 1. OCR Tasks

| Task | Module | Handler Coverage | Status |
|------|--------|-----------------|--------|
| `app.tasks.ocr_tasks.process_ocr` | `/app/tasks/ocr_tasks.py` | ✗ → ✓ | Fixed |

**Impact:** OCR jobs stuck in PENDING indefinitely, no database update

**Behavior:**
- Processes scanned PDF pages with Tesseract OCR
- Can take minutes to hours depending on page count
- Previously: No `AsyncJob.status` update on completion
- Now: Updates to 'completed' or 'failed' via signal handler

---

### 2. Document Processing Tasks

| Task | Module | Handler Coverage | Status |
|------|--------|-----------------|--------|
| `app.tasks.processing_tasks.merge_documents` | `/app/tasks/processing_tasks.py` | ✗ → ✓ | Fixed |
| `app.tasks.processing_tasks.split_document` | `/app/tasks/processing_tasks.py` | ✗ → ✓ | Fixed |

**Impact:** Merge/split jobs completely invisible to job tracking system

**Behavior:**
- `merge_documents`: Combines multiple PDFs into one
- `split_document`: Splits a PDF by page count or bookmarks
- Previously: No completion signal → jobs remain in PENDING forever
- Now: Both success and failure paths update `AsyncJob` status

---

### 3. Billing Tasks

| Task | Module | Handler Coverage | Status |
|------|--------|-----------------|--------|
| `billing.sync_plans_to_stripe` | `/app/tasks/billing_tasks.py` | ✗ → ✓ | Fixed |
| `billing.process_overdue_payments` | `/app/tasks/billing_tasks.py` | ✗ → ✓ | Fixed |
| `billing.process_expired_trials` | `/app/tasks/billing_tasks.py` | ✗ → ✓ | Fixed |
| `billing.send_trial_reminders` | `/app/tasks/billing_tasks.py` | ✗ → ✓ | Fixed |
| `billing.cleanup_stale_subscriptions` | `/app/tasks/billing_tasks.py` | ✗ → ✓ | Fixed |

**Impact:** Billing operations unmonitored, failures silent

**Behavior:**
- Periodic tasks (run via Celery Beat)
- Previously: No failure detection, no status tracking
- Now: All failures logged, stuck tasks auto-recovered by watchdog

---

### 4. Infrastructure Tasks

| Task | Module | Handler Coverage | Status |
|------|--------|-----------------|--------|
| `infra.collect_metrics` | `/app/tasks/infra_tasks.py` | ✗ → ✓ | Fixed |
| `infra.cleanup_old_metrics` | `/app/tasks/infra_tasks.py` | ✗ → ✓ | Fixed |
| `infra.watchdog_pending_tasks` | `/app/tasks/infra_tasks.py` | NEW | New |

**Impact:** Infrastructure monitoring tasks not tracked

**Behavior:**
- Periodic tasks for system health monitoring
- `infra.watchdog_pending_tasks`: NEW task that detects stuck jobs
- Previously: No status tracking
- Now: All tasks monitored, watchdog auto-recovers stuck jobs

---

## Task Coverage Comparison

### Before Fix

```
Covered by task_postrun handler:
  ✓ app.tasks.export_tasks.export_document
  ✓ app.tasks.export_tasks.cleanup_expired_exports

Covered by task_failure handler:
  ✓ All tasks (but generic handler)

NOT TRACKED via AsyncJob updates:
  ✗ app.tasks.ocr_tasks.process_ocr
  ✗ app.tasks.processing_tasks.merge_documents
  ✗ app.tasks.processing_tasks.split_document
  ✗ billing.*
  ✗ infra.* (except watchdog which didn't exist)
```

### After Fix

```
Covered by task_postrun handler (status update):
  ✓ app.tasks.export_tasks.* (existing)
  ✓ app.tasks.ocr_tasks.* (new)
  ✓ app.tasks.processing_tasks.* (new)
  ✓ billing.* (new)
  ✓ infra.* (new)

Covered by task_failure handler (error tracking):
  ✓ All tracked task families (new global handler)

Covered by watchdog (stuck detection):
  ✓ All tracked tasks (10-minute check, 1-hour timeout)
```

---

## Database Impact

### AsyncJob Records
All tasks now properly update their corresponding `AsyncJob` record:

**On Success (task_postrun):**
```python
job.status = 'completed'
job.progress = 100.0
job.completed_at = <datetime>
job.result = {...}
```

**On Failure (task_failure):**
```python
job.status = 'failed'
job.error_message = <exception message>
job.completed_at = <datetime>
```

**Watchdog Detection (after 1+ hour stuck):**
```python
job.status = 'failed'
job.error_message = 'Task stuck in pending state for 1+ hours...'
job.completed_at = <datetime>
```

---

## API Endpoints Affected

These API endpoints now provide accurate job status (were broken before):

1. **Job Status Queries**
   - `GET /api/v1/jobs/{job_id}` → Accurate status
   - `GET /api/v1/documents/{doc_id}/export-status` → Real-time tracking

2. **Job Polling**
   - WebSocket updates for OCR progress
   - WebSocket updates for merge/split progress

3. **Admin Dashboards**
   - Billing job monitoring
   - Infrastructure task status
   - Job queue health

---

## Monitoring & Alerting

### Logs to Watch

```bash
# Successful task completion
"Task app.tasks.ocr_tasks.process_ocr (task-id-123) completed with state SUCCESS"

# Task failure (normal)
"Task task-id-456 failed: IndexError: list index out of range"

# Watchdog detection (stuck job recovery)
"Found 3 tasks stuck in pending/processing state"
"Marking job xyz-abc (task_id=abc-123) as failed after 1h"
"Watchdog recovered 3 stuck tasks"
```

### Metrics to Monitor

- `celery.tasks.postrun_handler.calls` (should increase as tasks complete)
- `celery.tasks.failure_handler.calls` (failed tasks)
- `infra.watchdog_pending_tasks.recovered_count` (stuck jobs recovered)
- `async_job.status.pending` (should decrease over time)
- `async_job.status.processing` (should be short-lived)

---

## Testing Checklist

Use this to verify the fix works correctly:

### Unit Tests
- [ ] `test_postrun_handler_covers_all_tasks` - Verify all 5 task families handled
- [ ] `test_failure_handler_catches_exceptions` - Verify exceptions are caught
- [ ] `test_watchdog_marks_old_pending_jobs_failed` - Verify stuck job recovery
- [ ] `test_watchdog_in_beat_schedule` - Verify watchdog is scheduled

### Integration Tests
- [ ] Submit OCR job → check AsyncJob.status updates to 'completed'
- [ ] Submit merge job → check AsyncJob.status updates to 'completed'
- [ ] Submit split job → check AsyncJob.status updates to 'completed'
- [ ] Force task failure → check AsyncJob.status = 'failed', error_message set
- [ ] Create old pending job in DB → wait for watchdog → verify marked as failed

### Manual Verification
```bash
# 1. Check beat schedule includes watchdog
celery -A app.tasks.celery_app inspect scheduled
# Output should include:
#   {
#     'watchdog-pending-tasks': {
#       'task': 'infra.watchdog_pending_tasks',
#       'schedule': 600.0,
#       ...
#     }
#   }

# 2. Submit OCR job and monitor logs
curl -X POST /api/v1/documents/doc-123/ocr
# Logs should show:
#   "Task app.tasks.ocr_tasks.process_ocr (task-id) completed with state SUCCESS"

# 3. Query job status (should be updated)
curl /api/v1/jobs/job-123
# Response should include:
#   {
#     "status": "completed",
#     "progress": 100.0,
#     "completed_at": "2024-01-01T12:34:56Z"
#   }
```

---

## Known Limitations

### Not Covered
- External service tasks not registered with Celery (e.g., AWS Lambda)
- Tasks spawned by third-party libraries directly

### Watchdog Limitations
- Only catches tasks stuck in PENDING/PROCESSING
- Doesn't detect slow tasks (task that runs for 10+ hours is not stuck)
- Requires `AsyncJob.celery_task_id` to be set (manual tasks without this won't be recovered)

---

## Rollback Instructions

If critical issues arise:

1. **Revert code changes:**
   ```bash
   git revert <commit-hash>
   ```

2. **Reload workers:**
   ```bash
   pkill -TERM -f "celery worker"
   sleep 65
   celery -A app.tasks.celery_app worker
   ```

3. **Reload beat:**
   ```bash
   pkill -TERM -f "celery beat"
   sleep 5
   celery -A app.tasks.celery_app beat
   ```

4. **Cleanup stuck jobs** (optional):
   ```sql
   -- Re-mark old jobs that were recovered by watchdog as pending
   -- (only if you want to retry them)
   UPDATE async_jobs
   SET status = 'pending', error_message = NULL, completed_at = NULL
   WHERE status = 'failed'
   AND error_message LIKE 'Task stuck in pending state%'
   AND completed_at > NOW() - INTERVAL 1 DAY;
   ```

---

## Version Information

| Component | Version |
|-----------|---------|
| Celery | 5.x |
| Python | 3.12+ |
| SQLAlchemy | 2.0+ |
| PostgreSQL | 12+ |

All compatible with current stack.
