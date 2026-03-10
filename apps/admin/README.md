# GigaPDF Admin Dashboard

Super admin dashboard for managing the GigaPDF platform.

## Features

- **Authentication**: BetterAuth integration with super_admin role restriction
- **Dashboard Overview**: System statistics, usage charts, and recent activity
- **Tenant Management**: View, create, edit, and suspend tenant organizations
- **User Management**: Manage users across all tenants
- **Document Management**: View and manage all documents in the system
- **Background Jobs**: Monitor and manage system background tasks
- **System Logs**: View and filter system activity logs
- **Plan Management**: Configure subscription plans and pricing
- **Settings**: System-wide configuration options

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **UI**: React 19, Tailwind CSS, Radix UI components from @giga-pdf/ui
- **Authentication**: BetterAuth
- **Data Fetching**: TanStack Query
- **Tables**: TanStack Table
- **Charts**: Recharts
- **TypeScript**: Full type safety with shared types from @giga-pdf/types

## Getting Started

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- `NEXT_PUBLIC_ADMIN_URL`: Admin dashboard URL (default: http://localhost:3001)
- `NEXT_PUBLIC_API_URL`: Backend API URL
- `BETTER_AUTH_SECRET`: Secret key for authentication
- `DATABASE_URL`: PostgreSQL connection string

3. Run the development server:
```bash
pnpm dev
```

The admin dashboard will be available at http://localhost:3001

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/           # Protected admin routes
│   │   ├── dashboard/         # Overview page
│   │   ├── tenants/          # Tenant management
│   │   ├── users/            # User management
│   │   ├── documents/        # Document management
│   │   ├── jobs/             # Background jobs
│   │   ├── logs/             # System logs
│   │   ├── plans/            # Subscription plans
│   │   └── settings/         # System settings
│   ├── login/                # Login page
│   └── api/auth/             # Auth API routes
├── components/
│   ├── admin-header.tsx      # Top navigation bar
│   ├── admin-sidebar.tsx     # Side navigation
│   ├── data-table.tsx        # Reusable data table
│   ├── stats-card.tsx        # Statistics card
│   ├── charts/               # Chart components
│   └── providers.tsx         # React providers
├── lib/
│   ├── auth.ts               # BetterAuth configuration
│   └── utils.ts              # Utility functions
├── middleware.ts             # Route protection
└── styles/
    └── globals.css           # Global styles
```

## Pages

### Dashboard (`/dashboard`)
- System overview with key metrics
- Usage and revenue charts
- System status indicators
- Recent activity feed

### Tenants (`/tenants`)
- List of all tenant organizations
- Search and filter capabilities
- Create, edit, and suspend tenants
- View detailed tenant information (`/tenants/[id]`)

### Users (`/users`)
- User list across all tenants
- Filter by tenant, role, status
- User management actions

### Documents (`/documents`)
- All documents in the system
- Search by name, tenant
- Document actions (view, download, delete)

### Background Jobs (`/jobs`)
- Active and completed jobs
- Job status and progress
- Retry failed jobs
- Cancel running jobs

### System Logs (`/logs`)
- System activity logs
- Filter by level (info, warning, error)
- Search logs
- View log details

### Plans (`/plans`)
- Subscription plan overview
- Plan features and limits
- Pricing configuration
- Create and edit plans

### Settings (`/settings`)
- General system settings
- Email configuration
- Storage configuration
- Security settings

## Authentication

The admin dashboard uses BetterAuth for authentication. Only users with the `super_admin` role can access the dashboard.

### Login
- Navigate to `/login`
- Enter super admin credentials
- Redirected to dashboard on success

### Protected Routes
All routes except `/login` are protected by middleware that checks for:
1. Valid authentication session
2. `super_admin` role

## Development

### Adding New Pages

1. Create page in `src/app/(dashboard)/[page-name]/page.tsx`
2. Add route to sidebar in `src/components/admin-sidebar.tsx`
3. Implement page content with shared components

### Using Shared Components

```tsx
import { DataTable } from "@/components/data-table";
import { StatsCard } from "@/components/stats-card";
import { Badge } from "@giga-pdf/ui";

// Use in your page components
```

### Utility Functions

```tsx
import { formatBytes, formatDate, formatCurrency } from "@/lib/utils";
```

## Building for Production

```bash
pnpm build
pnpm start
```

## Notes

- Default port: 3001 (configured in package.json)
- Requires PostgreSQL database
- Shares types with main web app via @giga-pdf/types
- Mock data is used for demonstration; replace with actual API calls
- Authentication middleware is placeholder; implement actual checks

## TODO

- Implement actual BetterAuth session validation
- Connect to real API endpoints
- Add role-based permissions
- Implement audit logging
- Add email notifications
- Add export functionality for reports
- Implement real-time updates via WebSocket
