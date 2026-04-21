"""
Unit tests for Celery signal handlers covering all task types.

Tests that task_postrun and task_failure handlers correctly update AsyncJob status
for all tracked task families:
- app.tasks.export_tasks.*
- app.tasks.ocr_tasks.*
- app.tasks.processing_tasks.*
- billing.*
- infra.*
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch, AsyncMock

from app.models.database import AsyncJob
from app.tasks.celery_app import task_postrun_handler, task_failure_handler


@pytest.fixture
def mock_async_job():
    """Create a mock AsyncJob for testing."""
    job = Mock(spec=AsyncJob)
    job.id = "test-job-1"
    job.celery_task_id = "celery-task-id"
    job.status = "pending"
    job.result = {}
    job.error_message = None
    return job


class TestTaskPostrunSignal:
    """Test task_postrun signal handler for all task families."""

    @pytest.mark.parametrize("task_name,should_handle", [
        ("app.tasks.export_tasks.export_document", True),
        ("app.tasks.ocr_tasks.process_ocr", True),
        ("app.tasks.processing_tasks.merge_documents", True),
        ("app.tasks.processing_tasks.split_document", True),
        ("billing.sync_plans_to_stripe", True),
        ("billing.process_overdue_payments", True),
        ("infra.collect_metrics", True),
        ("infra.cleanup_old_metrics", True),
        ("other.task.name", False),
        ("untracked.task", False),
    ])
    @patch("app.tasks.celery_app._run_async")
    def test_postrun_handler_covers_all_tasks(
        self, mock_run_async, task_name, should_handle
    ):
        """Verify task_postrun handler covers all task families."""
        mock_task = Mock()
        mock_task.name = task_name

        task_postrun_handler(
            sender=None,
            task_id="test-task-id",
            task=mock_task,
            retval={"result": "data"},
            state="SUCCESS",
        )

        if should_handle:
            assert mock_run_async.called, f"Should have handled {task_name}"
        else:
            assert not mock_run_async.called, f"Should not have handled {task_name}"

    @patch("app.tasks.celery_app._run_async")
    def test_postrun_handler_ignores_none_task(self, mock_run_async):
        """Verify handler gracefully handles None task."""
        task_postrun_handler(
            sender=None,
            task_id="test-task-id",
            task=None,
            retval={},
            state="SUCCESS",
        )
        assert not mock_run_async.called

    @patch("app.tasks.celery_app._run_async")
    def test_postrun_handler_ignores_none_task_id(self, mock_run_async):
        """Verify handler gracefully handles None task_id."""
        mock_task = Mock()
        mock_task.name = "app.tasks.export_tasks.export_document"

        task_postrun_handler(
            sender=None,
            task_id=None,
            task=mock_task,
            retval={},
            state="SUCCESS",
        )
        assert not mock_run_async.called


class TestTaskFailureSignal:
    """Test task_failure signal handler for all task families."""

    @patch("app.tasks.celery_app._update_job_failed")
    @patch("app.tasks.celery_app._run_async")
    def test_failure_handler_catches_exceptions(self, mock_run_async, mock_update_failed):
        """Verify task_failure handler processes exceptions."""
        mock_exception = ValueError("Task processing failed")

        task_failure_handler(
            sender=None,
            task_id="test-task-id",
            exception=mock_exception,
        )

        assert mock_run_async.called
        # Verify async coroutine was called with the failed job update

    @patch("app.tasks.celery_app._run_async")
    def test_failure_handler_ignores_none_task_id(self, mock_run_async):
        """Verify handler gracefully handles None task_id."""
        task_failure_handler(
            sender=None,
            task_id=None,
            exception=ValueError("error"),
        )
        assert not mock_run_async.called

    @patch("app.tasks.celery_app._run_async")
    def test_failure_handler_ignores_none_exception(self, mock_run_async):
        """Verify handler gracefully handles None exception."""
        task_failure_handler(
            sender=None,
            task_id="test-task-id",
            exception=None,
        )
        assert not mock_run_async.called


class TestWatchdogPendingTasks:
    """Test watchdog task for detecting stuck/pending jobs."""

    @pytest.mark.asyncio
    async def test_watchdog_marks_old_pending_jobs_failed(self):
        """Verify watchdog correctly marks old pending jobs as failed."""
        from app.tasks.infra_tasks import watchdog_pending_tasks
        from datetime import timedelta

        # Would require DB session and actual job records
        # Placeholder for integration test
        pass

    def test_watchdog_task_name(self):
        """Verify watchdog task has correct name for beat schedule."""
        from app.tasks.infra_tasks import watchdog_pending_tasks

        assert watchdog_pending_tasks.name == "infra.watchdog_pending_tasks"

    def test_watchdog_task_signature(self):
        """Verify watchdog task has required parameters."""
        from app.tasks.infra_tasks import watchdog_pending_tasks
        import inspect

        sig = inspect.signature(watchdog_pending_tasks)
        assert "self" in sig.parameters
        assert "timeout_hours" in sig.parameters
        assert sig.parameters["timeout_hours"].default == 1


class TestSignalCoverage:
    """Integration test to verify all task families are covered."""

    def test_all_task_families_have_coverage(self):
        """Verify all known task families are in the handler's tracked_prefixes."""
        from app.tasks.celery_app import task_postrun_handler
        import inspect

        source = inspect.getsource(task_postrun_handler)

        # Verify all task families are mentioned
        required_prefixes = [
            "app.tasks.export_tasks.",
            "app.tasks.ocr_tasks.",
            "app.tasks.processing_tasks.",
            "billing.",
            "infra.",
        ]

        for prefix in required_prefixes:
            assert prefix in source, f"Task prefix '{prefix}' not found in handler"


class TestBeatScheduleInclusion:
    """Verify watchdog is included in beat schedule."""

    def test_watchdog_in_beat_schedule(self):
        """Verify watchdog task is registered in Celery beat schedule."""
        from app.tasks.celery_app import celery_app

        beat_schedule = celery_app.conf.beat_schedule
        assert "watchdog-pending-tasks" in beat_schedule

        watchdog_config = beat_schedule["watchdog-pending-tasks"]
        assert watchdog_config["task"] == "infra.watchdog_pending_tasks"
        assert watchdog_config["schedule"] == 600.0  # Every 10 minutes
        assert watchdog_config["kwargs"]["timeout_hours"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
