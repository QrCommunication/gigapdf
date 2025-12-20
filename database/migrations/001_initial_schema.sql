-- GigaPDF Complete Database Schema
-- Version: 1.0.0
-- Date: 2025-12-20
--
-- This script creates all tables needed by GigaPDF.
-- It's idempotent - safe to run multiple times.
--
-- Tables are organized by module:
-- 1. BetterAuth (Web App): users, accounts, sessions, verification
-- 2. BetterAuth (Admin): admin_users, admin_accounts, admin_sessions, admin_verification
-- 3. Core: folders, stored_documents, document_versions, document_shares
-- 4. Quotas & Plans: user_quotas, plans
-- 5. Jobs & Collaboration: async_jobs, collaboration_sessions, element_locks
-- 6. Activity: activity_logs
-- 7. Tenants: tenants, tenant_members, tenant_documents, tenant_invitations

-- ============================================================================
-- 1. BETTERAUTH - WEB APP
-- Note: Better Auth generates string IDs, not UUIDs. Use TEXT type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    name TEXT,
    image TEXT,
    locale TEXT DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    scope TEXT,
    password TEXT,
    "idToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS accounts_userId_idx ON accounts("userId");

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    token TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_userId_idx ON sessions("userId");

CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

-- ============================================================================
-- 2. BETTERAUTH - ADMIN APP
-- Note: Better Auth generates string IDs, not UUIDs. Use TEXT type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    name TEXT,
    image TEXT,
    role TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    scope TEXT,
    password TEXT,
    "idToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_accounts_userId_idx ON admin_accounts("userId");

CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    token TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_sessions_userId_idx ON admin_sessions("userId");

CREATE TABLE IF NOT EXISTS admin_verification (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_verification_identifier_idx ON admin_verification(identifier);

-- ============================================================================
-- 3. CORE - DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    path VARCHAR(1000) DEFAULT '/',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

CREATE TABLE IF NOT EXISTS stored_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(255) NOT NULL,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    page_count INTEGER DEFAULT 0,
    current_version INTEGER DEFAULT 1,
    file_size_bytes INTEGER DEFAULT 0,
    mime_type VARCHAR(100) DEFAULT 'application/pdf',
    tags JSONB DEFAULT '[]'::jsonb,
    metadata_cache JSONB,
    thumbnail_path VARCHAR(500),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stored_documents_owner ON stored_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_stored_documents_folder ON stored_documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_stored_documents_deleted ON stored_documents(is_deleted);

CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES stored_documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size_bytes INTEGER DEFAULT 0,
    file_hash VARCHAR(64) NOT NULL,
    comment TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    encryption_key TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_number ON document_versions(document_id, version_number);

CREATE TABLE IF NOT EXISTS document_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES stored_documents(id) ON DELETE CASCADE,
    shared_with_user_id VARCHAR(255),
    share_token VARCHAR(64) UNIQUE,
    permission VARCHAR(20) DEFAULT 'view',
    expires_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_shares_document ON document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_user ON document_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_token ON document_shares(share_token);

-- ============================================================================
-- 4. QUOTAS & PLANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    storage_used_bytes BIGINT DEFAULT 0,
    storage_limit_bytes BIGINT DEFAULT 5368709120,
    document_count INTEGER DEFAULT 0,
    document_limit INTEGER DEFAULT 1000,
    api_calls_used INTEGER DEFAULT 0,
    api_calls_limit INTEGER DEFAULT 1000,
    api_calls_reset_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    plan_type VARCHAR(20) DEFAULT 'free',
    plan_expires_at TIMESTAMPTZ,
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    subscription_status VARCHAR(50) DEFAULT 'none',
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    trial_start_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    has_used_trial BOOLEAN DEFAULT FALSE,
    is_suspended BOOLEAN DEFAULT FALSE,
    suspended_at TIMESTAMPTZ,
    suspension_reason VARCHAR(255),
    payment_failed_count INTEGER DEFAULT 0,
    last_payment_failed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_user_quotas_stripe ON user_quotas(stripe_customer_id);

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    interval VARCHAR(10) DEFAULT 'month',
    stripe_product_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    stripe_synced_at TIMESTAMPTZ,
    storage_limit_bytes BIGINT DEFAULT 5368709120,
    api_calls_limit INTEGER DEFAULT 1000,
    document_limit INTEGER DEFAULT 100,
    is_tenant_plan BOOLEAN DEFAULT FALSE,
    max_members INTEGER DEFAULT 1,
    linked_tenant_id UUID,
    features JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    is_popular BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    cta_text VARCHAR(50) DEFAULT 'Get Started',
    trial_days INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_plans_order ON plans(display_order);
CREATE INDEX IF NOT EXISTS idx_plans_tenant ON plans(is_tenant_plan);
CREATE INDEX IF NOT EXISTS idx_plans_linked_tenant ON plans(linked_tenant_id);

-- ============================================================================
-- 5. JOBS & COLLABORATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS async_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    celery_task_id VARCHAR(255),
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    progress FLOAT DEFAULT 0.0,
    document_id UUID,
    owner_id VARCHAR(255) NOT NULL,
    input_params JSONB,
    result JSONB,
    error_code VARCHAR(50),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_async_jobs_owner ON async_jobs(owner_id);
CREATE INDEX IF NOT EXISTS idx_async_jobs_status ON async_jobs(status);
CREATE INDEX IF NOT EXISTS idx_async_jobs_type ON async_jobs(job_type);

CREATE TABLE IF NOT EXISTS collaboration_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_color VARCHAR(7) DEFAULT '#3B82F6',
    socket_id VARCHAR(255),
    cursor_page INTEGER,
    cursor_x FLOAT,
    cursor_y FLOAT,
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_document ON collaboration_sessions(document_id);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_active ON collaboration_sessions(document_id, is_active);

CREATE TABLE IF NOT EXISTS element_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    element_id UUID NOT NULL,
    locked_by_user_id VARCHAR(255) NOT NULL,
    locked_by_session_id UUID NOT NULL,
    locked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_element_locks_document ON element_locks(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_element_locks_element ON element_locks(document_id, element_id);

-- ============================================================================
-- 6. ACTIVITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES stored_documents(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) DEFAULT 'document',
    extra_data JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    tenant_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_document ON activity_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_document_created ON activity_logs(document_id, created_at);

-- ============================================================================
-- 7. TENANTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    logo_url VARCHAR(500),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    website VARCHAR(255),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(2),
    plan_id UUID REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'trial' NOT NULL,
    trial_start_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    has_used_trial BOOLEAN DEFAULT FALSE NOT NULL,
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    storage_limit_bytes BIGINT DEFAULT 5368709120,
    storage_used_bytes BIGINT DEFAULT 0,
    api_calls_limit INTEGER DEFAULT 10000,
    api_calls_used INTEGER DEFAULT 0,
    api_calls_reset_at TIMESTAMPTZ,
    document_limit INTEGER DEFAULT 1000,
    document_count INTEGER DEFAULT 0,
    max_members INTEGER DEFAULT 5,
    allow_member_invites BOOLEAN DEFAULT TRUE,
    require_2fa BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS ix_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS ix_tenants_created_at ON tenants(created_at);

CREATE TABLE IF NOT EXISTS tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_quotas(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    custom_permissions TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_active_at TIMESTAMPTZ,
    CONSTRAINT uq_tenant_member UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_tenant_members_user_id ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS ix_tenant_members_tenant_id ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS ix_tenant_members_role ON tenant_members(role);

CREATE TABLE IF NOT EXISTS tenant_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES stored_documents(id) ON DELETE CASCADE,
    added_by_id UUID NOT NULL REFERENCES user_quotas(id),
    access_level VARCHAR(20) DEFAULT 'read' NOT NULL,
    added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_document UNIQUE (tenant_id, document_id)
);
CREATE INDEX IF NOT EXISTS ix_tenant_documents_tenant_id ON tenant_documents(tenant_id);
CREATE INDEX IF NOT EXISTS ix_tenant_documents_document_id ON tenant_documents(document_id);

CREATE TABLE IF NOT EXISTS tenant_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'member' NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    invited_by_id UUID NOT NULL REFERENCES user_quotas(id),
    is_accepted BOOLEAN DEFAULT FALSE NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_id UUID REFERENCES user_quotas(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tenant_invitations_email ON tenant_invitations(email);
CREATE INDEX IF NOT EXISTS ix_tenant_invitations_token ON tenant_invitations(token);
CREATE INDEX IF NOT EXISTS ix_tenant_invitations_tenant_id ON tenant_invitations(tenant_id);

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

-- Insert default plans if they don't exist
INSERT INTO plans (id, slug, name, description, price, currency, interval, storage_limit_bytes, api_calls_limit, document_limit, is_active, display_order, cta_text, features)
VALUES
    (gen_random_uuid(), 'free', 'Free', 'Pour commencer avec GigaPDF', 0, 'EUR', 'month', 5368709120, 1000, 100, true, 0, 'Commencer gratuitement', '{"features": ["5 GB stockage", "1000 appels API/mois", "100 documents max", "Support email"]}'),
    (gen_random_uuid(), 'pro', 'Pro', 'Pour les professionnels', 9.99, 'EUR', 'month', 53687091200, 10000, 1000, true, 1, 'Essayer Pro', '{"features": ["50 GB stockage", "10000 appels API/mois", "1000 documents max", "Support prioritaire", "OCR avancé"]}'),
    (gen_random_uuid(), 'enterprise', 'Enterprise', 'Pour les équipes et entreprises', 29.99, 'EUR', 'month', 536870912000, 100000, 10000, true, 2, 'Contacter les ventes', '{"features": ["500 GB stockage", "100000 appels API/mois", "Documents illimités", "Support 24/7", "SSO", "API dédiée"]}')
ON CONFLICT (slug) DO NOTHING;
