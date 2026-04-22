-- =============================================================================
-- Better Auth Tables Initialization
-- =============================================================================
-- This script creates the tables required by Better Auth.
-- It's safe to run multiple times (uses IF NOT EXISTS).
-- Run this AFTER Alembic migrations to avoid conflicts.
-- =============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
    name VARCHAR(255),
    image TEXT,
    locale VARCHAR(10) NOT NULL DEFAULT 'fr',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Idempotent column adds (safe re-run on existing deployments)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';

-- Accounts table (OAuth providers, password auth)
CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(255) PRIMARY KEY,
    "userId" VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(255) NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    scope TEXT,
    password TEXT,
    "idToken" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_userId_idx ON accounts("userId");

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    "userId" VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "ipAddress" VARCHAR(255),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_userId_idx ON sessions("userId");

-- Verification table (email verification, password reset)
CREATE TABLE IF NOT EXISTS verification (
    id VARCHAR(255) PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

-- JWKS table (JWT plugin keys)
CREATE TABLE IF NOT EXISTS jwks (
    id VARCHAR(255) PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE
);

-- =============================================================================
-- Ownership & permissions
-- =============================================================================
-- Tables may be created by the postgres superuser on first run. The app user
-- (gigapdf) needs ownership + full privileges to INSERT/UPDATE through Prisma.
-- Safe to re-run.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigapdf') THEN
        EXECUTE 'ALTER TABLE users OWNER TO gigapdf';
        EXECUTE 'ALTER TABLE accounts OWNER TO gigapdf';
        EXECUTE 'ALTER TABLE sessions OWNER TO gigapdf';
        EXECUTE 'ALTER TABLE verification OWNER TO gigapdf';
        EXECUTE 'ALTER TABLE jwks OWNER TO gigapdf';
        EXECUTE 'GRANT ALL PRIVILEGES ON TABLE users, accounts, sessions, verification, jwks TO gigapdf';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gigapdf';
    END IF;
END
$$;

-- =============================================================================
-- Done! Better Auth tables are ready.
-- =============================================================================
