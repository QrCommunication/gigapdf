"""
Database connection and session management.

Provides async SQLAlchemy engine and session factory,
plus sync versions for Celery workers.
"""

import logging
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator, Generator

from sqlalchemy import create_engine as create_sync_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models.database import Base

logger = logging.getLogger(__name__)

# Global async engine and session factory
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None

# Global sync engine and session factory (for Celery tasks)
_sync_engine: Engine | None = None
_sync_session_factory: sessionmaker[Session] | None = None


def get_database_url() -> str:
    """
    Get async database URL.

    Converts postgresql:// to postgresql+asyncpg://
    """
    settings = get_settings()
    url = settings.database_url

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)

    return url


def create_engine() -> AsyncEngine:
    """Create async SQLAlchemy engine."""
    settings = get_settings()

    engine = create_async_engine(
        get_database_url(),
        echo=settings.app_debug,
        pool_size=settings.database_pool_size,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=3600,
    )

    return engine


def get_engine() -> AsyncEngine:
    """Get or create the database engine."""
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get or create the session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _session_factory


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Provide a transactional database session.

    Automatically commits on success, rolls back on exception.

    Usage:
        async with get_db_session() as session:
            result = await session.execute(query)
    """
    session_factory = get_session_factory()
    session = session_factory()

    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def init_database() -> None:
    """
    Initialize database tables.

    Creates all tables if they don't exist.
    """
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables initialized")


async def close_database() -> None:
    """Close database connections."""
    global _engine, _session_factory

    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None

    logger.info("Database connections closed")


# Dependency for FastAPI
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for database session."""
    async with get_db_session() as session:
        yield session


# =============================================================================
# Sync database access (for Celery tasks)
# =============================================================================


def get_sync_database_url() -> str:
    """
    Get sync database URL.

    Uses psycopg2 driver instead of asyncpg.
    """
    settings = get_settings()
    url = settings.database_url

    # Ensure we have postgresql:// (sync driver)
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    return url


def get_sync_engine() -> Engine:
    """Get or create the sync database engine for Celery tasks."""
    global _sync_engine
    if _sync_engine is None:
        settings = get_settings()
        _sync_engine = create_sync_engine(
            get_sync_database_url(),
            echo=settings.app_debug,
            pool_size=5,
            max_overflow=5,
            pool_pre_ping=True,
            pool_recycle=3600,
        )
    return _sync_engine


def get_sync_session_factory() -> sessionmaker[Session]:
    """Get or create the sync session factory for Celery tasks."""
    global _sync_session_factory
    if _sync_session_factory is None:
        _sync_session_factory = sessionmaker(
            bind=get_sync_engine(),
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _sync_session_factory


@contextmanager
def get_sync_session() -> Generator[Session, None, None]:
    """
    Provide a transactional sync database session for Celery tasks.

    Automatically commits on success, rolls back on exception.

    Usage:
        with get_sync_session() as session:
            result = session.execute(query)
    """
    session_factory = get_sync_session_factory()
    session = session_factory()

    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
