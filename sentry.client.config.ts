import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // Capture 100% of errors
  // Dial this down if you hit quota limits on the free tier
  sampleRate: 1.0,

  // Only send errors in production
  environment: process.env.NODE_ENV,
});
