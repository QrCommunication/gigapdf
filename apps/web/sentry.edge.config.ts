import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || "unknown",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
