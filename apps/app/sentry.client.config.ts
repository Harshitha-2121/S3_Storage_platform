import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Default to 10% tracing in prod; 100% can be costly/noisy under real traffic.
  tracesSampleRate: Number(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
  ),
  debug: false,
  enabled: process.env.NODE_ENV === "production",
});
