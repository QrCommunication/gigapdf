# Signal Coverage Fix - Verification Checklist

Run this after deployment to verify the fix is working correctly.

---

## Pre-Deployment Checks

- [ ] All Python files compile without syntax errors
  ```bash
  python3 -m py_compile app/tasks/celery_app.py app/tasks/infra_tasks.py
  ```

- [ ] No import errors
  ```bash
  python3 -c "from app.tasks.celery_app import celery_app, task_postrun_handler, task_failure_handler"
  python3 -c "from app.tasks.infra_tasks import watchdog_pending_tasks"
  ```

- [ ] Beat schedule includes watchdog
  ```bash
  python3 -c "
from app.tasks.celery_app import celery_app
assert 'watchdog-pending-tasks' in celery_app.conf.beat_schedule
print('✓ Watchdog in beat schedule')
  "
  ```

---

## Post-Deployment Checks (Live)

### 1. Celery Workers Running

```bash
# Check workers are alive
celery -A app.tasks.celery_app inspect active

# Expected output: Worker pool status showing active tasks
```

### 2. Celery Beat Running

```bash
# Check beat scheduler
celery -A app.tasks.celery_app inspect scheduled

# Expected output:
{
  'celery@worker-1': {
    'watchdog-pending-tasks': {
      'task': 'infra.watchdog_pending_tasks',
      'schedule': 600.0,
      'kwargs': {'timeout_hours': 1},
      ...
    },
    ...
  }
}
```

### 3. Signal Handlers Registered

```bash
# Check signal connections
python3 << 'EOF'
from celery import signals
from app.tasks.celery_app import task_postrun_handler, task_failure_handler

# Verify handlers are connected
print("Receivers for task_postrun:")
for receiver in signals.task_postrun.receivers:
    print(f"  - {receiver}")

print("\nReceivers for task_failure:")
for receiver in signals.task_failure.receivers:
    print(f"  - {receiver}")

# Should show the new global handlers
assert len(signals.task_postrun.receivers) > 0, "No postrun handlers registered"
assert len(signals.task_failure.receivers) > 0, "No failure handlers registered"
print("\n✓ All signal handlers registered")
EOF
```

---

## Functional Tests (Can be run manually)

### Test 1: OCR Task Completion

```bash
# 1. Submit OCR task
RESPONSE=$(curl -X POST http://localhost:8000/api/v1/documents/test-doc-123/ocr \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "languages": "eng+fra",
    "output_type": "overlay"
  }')

JOB_ID=$(echo $RESPONSE | jq -r '.job_id')
echo "Job ID: $JOB_ID"

# 2. Poll job status (repeat every 10 seconds)
for i in {1..30}; do
  STATUS=$(curl -s http://localhost:8000/api/v1/jobs/$JOB_ID \
    -H "Authorization: Bearer YOUR_TOKEN" | jq -r '.status')
  echo "[$i] Status: $STATUS"
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "✓ Job completed with status: $STATUS"
    break
  fi
  
  sleep 10
done

# 3. Verify database update
python3 << 'PYEOF'
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from sqlalchemy import select

with get_sync_session() as session:
    job = session.execute(
        select(AsyncJob).where(AsyncJob.id == '$JOB_ID')
    ).scalar_one_or_none()
    
    if job:
        print(f"✓ Job found in DB")
        print(f"  Status: {job.status}")
        print(f"  Progress: {job.progress}%")
        print(f"  Completed at: {job.completed_at}")
        assert job.status in ['completed', 'failed']
    else:
        print(f"✗ Job not found")
PYEOF
```

### Test 2: Merge Document Task

```bash
# 1. Submit merge task
RESPONSE=$(curl -X POST http://localhost:8000/api/v1/documents/merge \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "document_configs": [
      {"document_id": "doc-1"},
      {"document_id": "doc-2"}
    ],
    "output_name": "merged.pdf"
  }')

JOB_ID=$(echo $RESPONSE | jq -r '.job_id')

# 2. Poll and verify (same as Test 1)
# Should see:
#   - Job status updates in real-time
#   - AsyncJob.status = 'completed' in DB
```

### Test 3: Force Task Failure

```bash
# Simulate a task failure
python3 << 'EOF'
from app.tasks.celery_app import celery_app, _run_async, _update_job_failed
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from datetime import datetime, timezone
from sqlalchemy import select

# Create a test job
with get_sync_session() as session:
    job = AsyncJob(
        celery_task_id="test-failure-123",
        status="processing",
        created_at=datetime.now(timezone.utc)
    )
    session.add(job)
    session.commit()
    job_id = job.id

# Simulate task_failure handler
task_failure_exc = ValueError("Simulated task failure")
_run_async(_update_job_failed("test-failure-123", str(task_failure_exc)))

# Verify DB update
with get_sync_session() as session:
    job = session.execute(
        select(AsyncJob).where(AsyncJob.id == job_id)
    ).scalar_one()
    
    print(f"✓ Failure handler updated job")
    print(f"  Status: {job.status}")
    print(f"  Error: {job.error_message}")
    assert job.status == 'failed'
    assert 'Simulated task failure' in job.error_message
EOF
```

### Test 4: Watchdog Stuck Task Detection

```bash
# 1. Create an old stuck job
python3 << 'EOF'
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from datetime import datetime, timezone, timedelta

with get_sync_session() as session:
    # Create job stuck for 2+ hours
    stuck_job = AsyncJob(
        celery_task_id="stuck-task-999",
        status="pending",
        created_at=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    session.add(stuck_job)
    session.commit()
    print(f"✓ Created stuck job: {stuck_job.id}")
EOF

# 2. Wait for watchdog to run (max 10 minutes)
sleep 600

# 3. Verify watchdog recovered it
python3 << 'EOF'
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from sqlalchemy import select

with get_sync_session() as session:
    job = session.execute(
        select(AsyncJob).where(AsyncJob.celery_task_id == "stuck-task-999")
    ).scalar_one()
    
    print(f"✓ Watchdog processed stuck job")
    print(f"  Status: {job.status}")
    print(f"  Error: {job.error_message[:80]}...")
    assert job.status == 'failed'
    assert 'stuck in pending state' in job.error_message
EOF

# 4. Check logs for watchdog output
grep "Watchdog recovered" /var/log/celery.log
# Expected: "Watchdog recovered 1 stuck tasks"
```

---

## Log Analysis

### Look for success indicators

```bash
# Should see task completions being logged
grep "Task app.tasks.ocr_tasks.process_ocr.*completed" logs/celery.log

# Should see watchdog running
grep "Starting watchdog check" logs/celery.log

# Should see job status updates
grep "Updated job.*status to completed" logs/app.log
```

### Red flags (indicate issues)

```bash
# Task failures not being logged
# → Check task_failure handler registration

# No watchdog log entries
# → Check Celery Beat is running
# → Check beat schedule configuration

# "Failed to update job status"
# → Check database connection
# → Check AsyncJob table exists

# "AttributeError: 'NoneType' object"
# → Check task object is not None in handler
```

---

## Performance Impact

Monitor these metrics post-deployment:

```bash
# Task processing time (should be unchanged)
# Before: ~same as after
# After fix: +milliseconds for signal handler

# Database writes (will increase)
# Before: Only export tasks update DB
# After: All 5 task families update DB

# Watchdog query performance (should be minimal)
# Query: SELECT * FROM async_jobs WHERE status IN ('pending', 'processing') AND created_at < X
# Expected: < 100ms on tables with < 100k records
```

---

## Rollback Verification

If you need to rollback, verify it worked:

```bash
# 1. Confirm old behavior is restored
grep "Only handle export tasks" app/tasks/celery_app.py
# If this line is back, rollback succeeded

# 2. Restart workers
pkill -TERM -f "celery worker"
sleep 65
celery -A app.tasks.celery_app worker

# 3. Verify non-export tasks no longer tracked
python3 << 'EOF'
from app.core.database import get_sync_session
from app.models.database import AsyncJob
from datetime import datetime, timezone
from sqlalchemy import select

# Submit OCR job and check it's NOT updated in DB
# (to confirm rollback to old behavior)
EOF
```

---

## Final Validation Script

Run this complete validation:

```bash
#!/bin/bash

echo "=== Signal Coverage Fix Verification ==="
echo ""

# 1. Syntax check
echo "[1/6] Checking Python syntax..."
python3 -m py_compile app/tasks/celery_app.py app/tasks/infra_tasks.py
if [ $? -eq 0 ]; then echo "✓ Syntax OK"; else echo "✗ FAILED"; exit 1; fi

# 2. Import check
echo "[2/6] Checking imports..."
python3 -c "from app.tasks.celery_app import celery_app, task_postrun_handler" && echo "✓ Imports OK" || (echo "✗ FAILED"; exit 1)

# 3. Beat schedule
echo "[3/6] Checking beat schedule..."
python3 << 'EOF'
from app.tasks.celery_app import celery_app
if 'watchdog-pending-tasks' in celery_app.conf.beat_schedule:
    print("✓ Watchdog in schedule")
else:
    print("✗ Watchdog missing from schedule")
    exit(1)
EOF

# 4. Workers status
echo "[4/6] Checking Celery workers..."
celery -A app.tasks.celery_app inspect active > /dev/null 2>&1 && echo "✓ Workers alive" || echo "⚠ Workers not responding (OK if starting up)"

# 5. Beat status
echo "[5/6] Checking Celery beat..."
celery -A app.tasks.celery_app inspect scheduled > /dev/null 2>&1 && echo "✓ Beat responsive" || echo "⚠ Beat not responding (OK if starting up)"

# 6. Database
echo "[6/6] Checking database..."
python3 << 'EOF'
from app.core.database import get_sync_session
from app.models.database import AsyncJob
try:
    with get_sync_session() as session:
        session.query(AsyncJob).first()
    print("✓ Database connection OK")
except Exception as e:
    print(f"✗ Database error: {e}")
    exit(1)
EOF

echo ""
echo "=== All checks passed! ==="
```

Save as `verify_fix.sh` and run:
```bash
chmod +x verify_fix.sh
./verify_fix.sh
```

---

## Support

If any check fails:

1. **Syntax error?** → Check Python version (3.12+)
2. **Import error?** → Verify virtualenv activated
3. **Workers not responding?** → Restart with: `pkill -TERM -f "celery worker"`
4. **Beat not running?** → Start with: `celery -A app.tasks.celery_app beat`
5. **Database error?** → Check PostgreSQL connection and `AsyncJob` table exists

Contact: rony@qrcommunication.com
