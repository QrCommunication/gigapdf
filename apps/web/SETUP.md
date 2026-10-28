# GigaPDF Web Application - Setup Guide

This guide will help you set up and run the GigaPDF web application.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 20 or higher
- **pnpm** 9 or higher
- **PostgreSQL** database
- **Git**

## Installation Steps

### 1. Install Dependencies

From the root of the monorepo, run:

```bash
pnpm install
```

This will install all dependencies for the entire monorepo, including the web application and all shared packages.

### 2. Build Shared Packages

Before running the web app, you need to build the shared packages:

```bash
pnpm build:packages
```

This builds:
- `@giga-pdf/types` - TypeScript type definitions
- `@giga-pdf/ui` - Shared UI components
- `@giga-pdf/api` - API client and hooks

### 3. Set Up Environment Variables

Copy the example environment file:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` and configure the following variables:

```env
# App URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# BetterAuth
BETTER_AUTH_SECRET=your-super-secret-key-at-least-32-chars-long
BETTER_AUTH_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/gigapdf
```

**Important Notes:**
- `BETTER_AUTH_SECRET` should be a random string at least 32 characters long
- Generate a secure secret with: `openssl rand -base64 32`
- Ensure your PostgreSQL database exists and is accessible

### 4. Set Up Database

Every table — the Better Auth ones included — is created by the backend's
Alembic migrations (`025_prisma_owned_tables` for the tables only Prisma
models describe). From the repository root, with the Python venv active:

```bash
alembic upgrade head
cd apps/web && npx prisma generate
```

Never run `prisma db push` / `prisma migrate` here: the database is shared
with the backend, and they would realign it entirely on this Prisma schema.

### 5. Run Development Server

From the root of the monorepo:

```bash
pnpm dev:web
```

Or directly from the web app directory:

```bash
cd apps/web
pnpm dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## BetterAuth Setup

### Database Schema

The Better Auth models live in `apps/web/prisma/schema.prisma` (`users`,
`sessions`, `accounts`, `verification`, `jwks`). Their tables are created by
Alembic (`migrations/versions/025_prisma_owned_tables.py`); changing one of
these models requires a new Alembic migration — the integration test
`tests/integration/test_migration_025_prisma_owned_tables.py` compares the
migrated database with the Prisma models and fails on any difference.

### JWT Configuration

The application is configured to use JWT tokens with RS256 signing for compatibility with the FastAPI backend. The JWT configuration is in `src/lib/auth.ts`.

## Directory Structure Overview

```
apps/web/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/              # Auth routes (login, register, etc.)
│   │   ├── (dashboard)/         # Protected dashboard routes
│   │   ├── editor/[id]/         # PDF editor
│   │   ├── api/auth/[...all]/   # BetterAuth API route
│   │   ├── layout.tsx           # Root layout
│   │   └── page.tsx             # Landing page
│   ├── components/
│   │   ├── auth/                # Authentication components
│   │   ├── dashboard/           # Dashboard components
│   │   └── providers.tsx        # Theme provider
│   ├── lib/
│   │   ├── auth.ts              # BetterAuth server config
│   │   ├── auth-client.ts       # BetterAuth client hooks
│   │   └── utils.ts             # Utility functions
│   ├── middleware.ts            # Route protection
│   └── styles/
│       └── globals.css          # Global styles
├── .env.example
├── .env.local (create this)
├── package.json
├── tsconfig.json
└── next.config.ts
```

## Common Commands

```bash
# Development
pnpm dev                 # Start dev server
pnpm build              # Build for production
pnpm start              # Start production server

# Quality
pnpm lint               # Run ESLint
pnpm type-check         # Run TypeScript type checking
pnpm clean              # Clean build artifacts
```

## Troubleshooting

### Module Not Found Errors

If you see errors about missing `@giga-pdf/*` packages:

```bash
# Rebuild shared packages
pnpm build:packages
```

### BetterAuth Database Errors

If you see database connection errors:

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` in `.env.local`
3. Ensure database exists
4. Run `alembic upgrade head` from the repository root

### Port Already in Use

If port 3000 is in use, specify a different port:

```bash
PORT=3001 pnpm dev
```

### TypeScript Errors

If you see TypeScript errors:

```bash
# Clear Next.js cache
rm -rf .next

# Rebuild
pnpm build
```

## Next Steps

1. **Configure Backend**: Ensure your FastAPI backend is running at the URL specified in `NEXT_PUBLIC_API_URL`
2. **Test Authentication**: Try registering a new user and logging in
3. **Customize**: Update branding, colors, and content to match your needs
4. **Add Features**: The editor route is a placeholder - integrate your PDF editing library

## Production Deployment

Before deploying to production:

1. Set `NODE_ENV=production`
2. Use a strong `BETTER_AUTH_SECRET`
3. Enable email verification in `src/lib/auth.ts`
4. Configure proper CORS settings
5. Use HTTPS for all URLs
6. Set up proper database backups
7. Configure monitoring and logging

## Support

For issues or questions:
- Check the [Next.js documentation](https://nextjs.org/docs)
- Review [BetterAuth documentation](https://better-auth.com)
- Check the monorepo root README.md
