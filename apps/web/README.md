# GigaPDF Web Application

The main Next.js 15 web application for GigaPDF - a professional PDF editor SaaS platform.

## Features

- **Next.js 15** with App Router
- **BetterAuth** authentication with JWT support
- **Responsive Design** with Tailwind CSS
- **Dark Mode** support with next-themes
- **Protected Routes** with middleware
- **TypeScript** for type safety
- **Monorepo Integration** with shared packages

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database

### Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

Required environment variables:
- `NEXT_PUBLIC_APP_URL`: Your application URL
- `NEXT_PUBLIC_API_URL`: FastAPI backend URL
- `NEXT_PUBLIC_WS_URL`: WebSocket server URL
- `BETTER_AUTH_SECRET`: Secret key for BetterAuth
- `BETTER_AUTH_URL`: BetterAuth server URL
- `DATABASE_URL`: PostgreSQL connection string

### Installation

From the root of the monorepo:

```bash
pnpm install
```

### Development

Run the development server:

```bash
pnpm dev:web
```

Or from the root:

```bash
pnpm --filter=web dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Build

Build the application for production:

```bash
pnpm build
```

### Type Check

Run TypeScript type checking:

```bash
pnpm type-check
```

### Lint

Run ESLint:

```bash
pnpm lint
```

## Project Structure

```
apps/web/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/            # Authentication routes
│   │   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── editor/            # PDF editor
│   │   └── api/               # API routes
│   ├── components/            # React components
│   │   ├── auth/              # Authentication components
│   │   └── dashboard/         # Dashboard components
│   ├── lib/                   # Utility libraries
│   │   ├── auth.ts           # BetterAuth server config
│   │   ├── auth-client.ts    # BetterAuth client hooks
│   │   └── utils.ts          # Helper functions
│   ├── middleware.ts          # Next.js middleware
│   └── styles/               # Global styles
├── package.json
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

## Authentication

This application uses [BetterAuth](https://better-auth.com) for authentication with the following features:

- Email/password authentication
- JWT tokens with RS256 signing (compatible with FastAPI backend)
- Session management
- Protected routes via middleware
- Email verification (configurable)
- Password reset functionality

### Protected Routes

All routes except `/`, `/login`, `/register`, and `/forgot-password` are protected. The middleware automatically redirects unauthenticated users to the login page.

## Shared Packages

This app uses the following shared packages from the monorepo:

- `@giga-pdf/ui`: Shared UI components (shadcn/ui based)
- `@giga-pdf/types`: TypeScript type definitions
- `@giga-pdf/api`: API client and hooks
- `@giga-pdf/tailwind-config`: Shared Tailwind configuration
- `@giga-pdf/typescript-config`: Shared TypeScript configuration
- `@giga-pdf/eslint-config`: Shared ESLint configuration

## Development Notes

### Adding New Routes

1. Create a new directory in `src/app/`
2. Add a `page.tsx` file
3. Update middleware if the route needs protection

### Adding Components

1. Create component in `src/components/`
2. Import from `@giga-pdf/ui` for shared components
3. Use `cn()` utility for conditional classes

### Styling

- Uses Tailwind CSS with custom design tokens
- Dark mode via `next-themes`
- Shared configuration from `@giga-pdf/tailwind-config`

## License

Private - All rights reserved
