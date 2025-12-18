"""Alembic migration environment configuration."""

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool, text, inspect

# Add project root to path for imports
project_root = Path(__file__).parents[1]
sys.path.insert(0, str(project_root))

# Load environment variables from .env
load_dotenv(project_root / ".env")

# Import models for autogenerate
from app.models.database import Base

# Alembic Config object
config = context.config

# Override sqlalchemy.url from environment
database_url = os.getenv("DATABASE_URL")
if database_url:
    # Ensure it's not async (Alembic uses sync driver)
    if "postgresql+asyncpg" in database_url:
        database_url = database_url.replace("postgresql+asyncpg", "postgresql")
    # Escape % for ConfigParser interpolation
    database_url_escaped = database_url.replace("%", "%%")
    config.set_main_option("sqlalchemy.url", database_url_escaped)

# Interpret config file for logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Add model's MetaData object for 'autogenerate' support
target_metadata = Base.metadata


def ensure_alembic_version_column_size(connection) -> None:
    """
    Ensure alembic_version.version_num column can hold longer revision IDs.

    Default is VARCHAR(32) which is too short for descriptive revision names.
    This function resizes it to VARCHAR(255) if needed.
    """
    inspector = inspect(connection)

    # Check if alembic_version table exists
    if "alembic_version" not in inspector.get_table_names():
        return

    # Check current column size
    columns = inspector.get_columns("alembic_version")
    for col in columns:
        if col["name"] == "version_num":
            # Get the column type length
            col_type = str(col["type"])
            if "VARCHAR(32)" in col_type.upper():
                # Resize to 255
                connection.execute(
                    text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)")
                )
                connection.commit()
            break


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well. By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # Ensure alembic_version column can hold long revision IDs
        ensure_alembic_version_column_size(connection)

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
