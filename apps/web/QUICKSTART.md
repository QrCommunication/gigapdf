# GigaPDF Web - Quick Start Guide

Get the GigaPDF web application up and running in 5 minutes.

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL running locally or remotely

## Step-by-Step Setup

### 1. Install Dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Build Shared Packages

```bash
pnpm build:packages
```

This builds `@giga-pdf/types`, `@giga-pdf/ui`, and `@giga-pdf/api`.

### 3. Configure Environment

```bash
cd apps/web
cp .env.example .env.local
```

Edit `.env.local` with your settings:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

BETTER_AUTH_SECRET=generate-a-random-32-char-string-here
BETTER_AUTH_URL=http://localhost:3000

DATABASE_URL=postgresql://username:password@localhost:5432/gigapdf
```

**Generate a secure secret:**
```bash
openssl rand -base64 32
```

### 4. Setup Database

Make sure PostgreSQL is running and the database exists:

```bash
# Create database if it doesn't exist
createdb gigapdf

# Generate Prisma client and push schema
pnpm db:generate
pnpm db:push
```

### 5. Start Development Server

From the root:

```bash
pnpm dev:web
```

Or from apps/web:

```bash
pnpm dev
```

### 6. Open in Browser

Navigate to [http://localhost:3000](http://localhost:3000)

## What You'll See

### Landing Page
- Professional landing page at `/`
- Sign up and sign in buttons
- Feature highlights

### Authentication
- **Register**: Create a new account at `/register`
- **Login**: Sign in at `/login`
- **Forgot Password**: Reset password at `/forgot-password`

### Dashboard
After logging in, you'll be redirected to `/dashboard` with:
- Statistics cards (total documents, storage, recent activity)
- Recent documents grid
- Sidebar navigation

### Available Routes
- `/dashboard` - Main dashboard
- `/documents` - All documents with search
- `/documents/[id]` - Document details
- `/editor/[id]` - PDF editor (placeholder)
- `/settings` - User settings
- `/billing` - Subscription and billing

## Default Test Data

The application includes mock documents for demonstration. In production, these will be replaced with real API calls.

## Common Issues

### Port 3000 in use
```bash
PORT=3001 pnpm dev
```

### Database connection failed
- Check PostgreSQL is running
- Verify DATABASE_URL is correct
- Ensure database exists

### Module not found errors
```bash
# Rebuild packages
cd ../..
pnpm build:packages
```

### Type errors
```bash
# Clean and rebuild
pnpm clean
pnpm build
```

## Next Steps

1. **Test Authentication**: Create an account and log in
2. **Explore Dashboard**: Navigate through different sections
3. **Check Dark Mode**: Toggle theme in settings
4. **Review Code**: Explore the source code structure
5. **Connect Backend**: Point NEXT_PUBLIC_API_URL to your FastAPI server

## Development Workflow

```bash
# Start dev server
pnpm dev:web

# In another terminal, watch database
pnpm db:studio

# Run type checking
pnpm type-check

# Run linting
pnpm lint

# Build for production
pnpm build
```

## File Structure Quick Reference

```
apps/web/
├── src/
│   ├── app/              # Routes and pages
│   ├── components/       # React components
│   ├── lib/             # Utilities and configs
│   ├── middleware.ts    # Route protection
│   └── styles/          # Global styles
├── prisma/
│   └── schema.prisma    # Database schema
├── .env.local           # Environment variables (create this)
├── package.json         # Dependencies
└── next.config.ts       # Next.js config
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Check TypeScript types |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:studio` | Open Prisma Studio |

## Support

- **Documentation**: See README.md and SETUP.md
- **Implementation Details**: See IMPLEMENTATION_SUMMARY.md
- **Issues**: Check the monorepo issue tracker

## Ready to Code!

Your GigaPDF web application is now ready for development. Start by exploring the codebase and customizing it to your needs.

Happy coding! 🚀
