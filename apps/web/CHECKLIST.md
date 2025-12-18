# GigaPDF Web Application - Setup Checklist

Use this checklist to ensure everything is properly set up.

## Pre-Setup

- [ ] Node.js 20+ installed (`node --version`)
- [ ] pnpm 9+ installed (`pnpm --version`)
- [ ] PostgreSQL installed and running
- [ ] Git installed

## Initial Setup

- [ ] Cloned repository
- [ ] Navigated to project root
- [ ] Ran `pnpm install`
- [ ] Ran `pnpm build:packages` successfully

## Environment Configuration

- [ ] Created `apps/web/.env.local` from `.env.example`
- [ ] Set `NEXT_PUBLIC_APP_URL` (e.g., http://localhost:3000)
- [ ] Set `NEXT_PUBLIC_API_URL` (e.g., http://localhost:8000)
- [ ] Set `NEXT_PUBLIC_WS_URL` (e.g., ws://localhost:8000)
- [ ] Generated and set `BETTER_AUTH_SECRET` (32+ characters)
- [ ] Set `BETTER_AUTH_URL` (same as NEXT_PUBLIC_APP_URL)
- [ ] Set `DATABASE_URL` with correct PostgreSQL credentials

## Database Setup

- [ ] PostgreSQL server is running
- [ ] Database `gigapdf` exists (or create with `createdb gigapdf`)
- [ ] Ran `pnpm db:generate` (from apps/web)
- [ ] Ran `pnpm db:push` (from apps/web)
- [ ] No errors in database setup

## Development Server

- [ ] Ran `pnpm dev:web` from root (or `pnpm dev` from apps/web)
- [ ] Server started without errors
- [ ] Opened http://localhost:3000 in browser
- [ ] Landing page loads correctly

## Testing Authentication

- [ ] Click "Get Started" or "Sign Up" button
- [ ] Registration form appears at `/register`
- [ ] Create test account with email and password
- [ ] Successfully registered and redirected to dashboard
- [ ] Dashboard shows with sidebar navigation
- [ ] Can navigate to different sections

### Test All Routes

- [ ] `/` - Landing page works
- [ ] `/register` - Registration form works
- [ ] `/login` - Login form works
- [ ] `/forgot-password` - Password reset form appears
- [ ] `/dashboard` - Dashboard with stats loads
- [ ] `/documents` - Documents page with search
- [ ] `/documents/1` - Document detail page loads
- [ ] `/editor/1` - Editor interface appears
- [ ] `/settings` - Settings page loads
- [ ] `/billing` - Billing page loads

## Testing Features

### Authentication Flow
- [ ] Can register a new account
- [ ] Can log in with created account
- [ ] Session persists on page reload
- [ ] Can log out successfully
- [ ] Redirected to login when accessing protected routes while logged out
- [ ] Redirected to dashboard when accessing auth pages while logged in

### UI Features
- [ ] Dark mode toggle works in settings
- [ ] Theme persists after refresh
- [ ] Sidebar collapses on mobile
- [ ] All buttons are clickable
- [ ] Forms validate input
- [ ] Error messages display correctly

### Navigation
- [ ] Can navigate between dashboard sections
- [ ] Back button works correctly
- [ ] Protected routes require authentication
- [ ] Redirect after login works

## Verification

### Code Quality
- [ ] Run `pnpm type-check` - no TypeScript errors
- [ ] Run `pnpm lint` - no ESLint errors
- [ ] No console errors in browser

### Performance
- [ ] Pages load quickly
- [ ] No layout shifts
- [ ] Smooth animations

### Browser Testing
- [ ] Works in Chrome/Edge
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works on mobile browser

## Optional Enhancements

- [ ] Configure email sending for password reset
- [ ] Add OAuth providers (Google, GitHub)
- [ ] Connect to real FastAPI backend
- [ ] Implement PDF editor functionality
- [ ] Add file upload capability
- [ ] Set up WebSocket for real-time features

## Production Readiness

- [ ] Environment variables configured for production
- [ ] Database migrations tested
- [ ] Build succeeds (`pnpm build`)
- [ ] Production build tested (`pnpm start`)
- [ ] Error handling implemented
- [ ] Security headers configured
- [ ] HTTPS configured
- [ ] Rate limiting added
- [ ] Monitoring set up
- [ ] Backups configured

## Troubleshooting

If you encounter issues, check:

1. **Dependencies**: Run `pnpm install` again
2. **Build**: Run `pnpm build:packages`
3. **Environment**: Verify all `.env.local` variables
4. **Database**: Check PostgreSQL connection
5. **Ports**: Ensure 3000 is available
6. **Cache**: Clear `.next` folder and rebuild

## Documentation Review

- [ ] Read README.md
- [ ] Read SETUP.md
- [ ] Read QUICKSTART.md
- [ ] Read IMPLEMENTATION_SUMMARY.md
- [ ] Understand project structure

## Ready for Development

Once all items are checked, you're ready to:
- Customize the UI and branding
- Connect to your backend API
- Implement PDF editing features
- Add your business logic
- Deploy to production

---

**Status**: [ ] All items checked - Ready to develop!

Last updated: 2024-12-18
