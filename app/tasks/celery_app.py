"""
Celery application configuration.

Configures Celery for async task processing including
OCR, export, merge, and split operations.
"""

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "giga-pdf",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.ocr_tasks",
        "app.tasks.export_tasks",
        "app.tasks.processing_tasks",
        "app.tasks.billing_tasks",
    ],
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Task execution settings
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=settings.job_timeout_seconds,
    task_soft_time_limit=settings.job_timeout_seconds - 60,

    # Worker settings
    worker_prefetch_multiplier=1,
    worker_concurrency=4,

    # Result settings
    result_expires=3600,  # 1 hour

    # Rate limiting
    task_annotations={
        "app.tasks.ocr_tasks.process_ocr": {"rate_limit": "10/m"},
        "app.tasks.export_tasks.export_document": {"rate_limit": "20/m"},
    },

    # Queues
    task_routes={
        "app.tasks.ocr_tasks.*": {"queue": "ocr"},
        "app.tasks.export_tasks.*": {"queue": "export"},
        "app.tasks.processing_tasks.*": {"queue": "processing"},
        "app.tasks.billing_tasks.*": {"queue": "billing"},
        "billing.*": {"queue": "billing"},
    },

    # Default queue
    task_default_queue="default",

    # Celery Beat schedule for periodic tasks
    beat_schedule={
        # Billing tasks
        "sync-plans-to-stripe": {
            "task": "billing.sync_plans_to_stripe",
            "schedule": 3600.0,  # Every hour
        },
        "process-overdue-payments": {
            "task": "billing.process_overdue_payments",
            "schedule": 86400.0,  # Every 24 hours
        },
        "process-expired-trials": {
            "task": "billing.process_expired_trials",
            "schedule": 3600.0,  # Every hour
        },
        "send-trial-reminders": {
            "task": "billing.send_trial_reminders",
            "schedule": 86400.0,  # Every 24 hours
        },
        "cleanup-stale-subscriptions": {
            "task": "billing.cleanup_stale_subscriptions",
            "schedule": 86400.0,  # Every 24 hours
        },
    },
)
