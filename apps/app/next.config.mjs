process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || "--max-old-space-size=8192";

import "./src/env.mjs";
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@v1/ui", "@v1/backend", "@v1/analytics", "@v1/logger"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

export default process.env.NODE_ENV === "production"
  ? withSentryConfig(nextConfig, {
      silent: !process.env.CI,
      telemetry: false,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
      tunnelRoute: "/monitoring",
    })
  : nextConfig;
