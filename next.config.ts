import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Block MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Legacy XSS filter (belt-and-braces)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Limit referrer leakage
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Restrict browser feature access
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Force HTTPS for 1 year (only meaningful on prod)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js injects inline scripts; wagmi/RainbowKit need eval for dynamic imports
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind + component libraries use inline styles
      "style-src 'self' 'unsafe-inline'",
      // Allow data URIs and HTTPS images (subgraph metadata avatars, etc.)
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      // Allow all HTTPS + WebSocket connections (wallet RPC, subgraph, WalletConnect)
      "connect-src 'self' https: wss:",
      // No embedding us in iframes
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  compress: true,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      // Page renamed to Indexer QoS (v4.10.0); preserve old bookmarks/links.
      { source: '/network-health', destination: '/indexer-qos', permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress source map upload logs in CI
  silent: true,

  // Upload source maps for readable stack traces
  // Requires SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT env vars
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,
});
