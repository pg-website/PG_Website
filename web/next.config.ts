import type { NextConfig } from 'next'
import withBundleAnalyzer from '@next/bundle-analyzer'
import { assertBuildEnv } from './src/lib/env/guard.ts'
import { parsePublicEnv } from './src/lib/env/public-schema.ts'
import { parseServerEnv } from './src/lib/env/server-schema.ts'
import { assertCspEnv, readCspConfig } from './src/lib/security/csp.ts'
import { buildHeaderRules } from './src/lib/security/headers.ts'

// Refuses mocks on production/staging builds and secret-looking NEXT_PUBLIC_* names, even for a bare `next build`.
assertBuildEnv(process.env)

// Fail fast on malformed public variables at dev/build start (the same schema runs again at module load).
const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE,
  NEXT_PUBLIC_GOOGLE_AUTH: process.env.NEXT_PUBLIC_GOOGLE_AUTH,
  NEXT_PUBLIC_RAZORPAY_ENABLED: process.env.NEXT_PUBLIC_RAZORPAY_ENABLED,
  NEXT_PUBLIC_CONTACT_MODE: process.env.NEXT_PUBLIC_CONTACT_MODE,
  NEXT_PUBLIC_SUPABASE_STORAGE_HOST: process.env.NEXT_PUBLIC_SUPABASE_STORAGE_HOST,
  NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  NEXT_PUBLIC_MEDIA_BUCKET: process.env.NEXT_PUBLIC_MEDIA_BUCKET,
})

// Required when mocks are off: the rewrite destination (the schema in lib/env/server-schema.ts validates it at runtime).
const apiInternalUrl = parseServerEnv(
  { API_INTERNAL_URL: process.env.API_INTERNAL_URL, REVALIDATE_SECRET: process.env.REVALIDATE_SECRET },
  { mocks: true },
).API_INTERNAL_URL
if (!publicEnv.USE_MOCKS && apiInternalUrl === undefined) {
  throw new Error('API_INTERNAL_URL is required when NEXT_PUBLIC_USE_MOCKS is not true (the /api rewrite destination).')
}

// Exact host and path, no wildcards (ARCH-001 13.3, F-24). Mock builds use local /placeholders/*.
const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] =
  publicEnv.SUPABASE_STORAGE_HOST !== undefined && publicEnv.MEDIA_BUCKET !== undefined
    ? [
        {
          protocol: 'https',
          hostname: publicEnv.SUPABASE_STORAGE_HOST,
          pathname: `/storage/v1/object/public/${publicEnv.MEDIA_BUCKET}/**`,
          search: '',
        },
      ]
    : []

// Edge policy (TASK-120): CSP strings come only from lib/security/csp.ts. Public pages get the static policy here, client
// groups get the nonce policy from src/proxy.ts, /api and unknown paths are covered so no route is left without a CSP
// (SEC-001 F-05). Report-Only is refused on production by resolveCspMode.
assertCspEnv(process.env)
const cspConfig = readCspConfig(process.env)
const headerRules = buildHeaderRules(cspConfig, process.env)

const nextConfig: NextConfig = {
  // web/ is an independent package; pin the root so the parent repo lockfile is not inferred.
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  experimental: {
    agentUpgrade: 'security',
  },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    qualities: [75],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: false,
    remotePatterns,
  },
  headers() {
    return Promise.resolve(headerRules.map((rule) => ({ source: rule.source, headers: [...rule.headers] })))
  },
  // Same-origin `/api/*` goes to the Django backend (ARCH-001 12.7). `afterFiles` runs after filesystem route handlers
  // (/api/revalidate, /api/draft, /api/draft/exit, /api/csp-report), so those keep winning. /api is not in the proxy matcher.
  // No-op with mocks on (the mock adapter never calls the network).
  rewrites() {
    const target = apiInternalUrl
    if (publicEnv.USE_MOCKS || target === undefined) return Promise.resolve([])
    return Promise.resolve({
      beforeFiles: [],
      afterFiles: [{ source: '/api/:path*', destination: `${target}/api/:path*` }],
      fallback: [],
    })
  },
}

// `ANALYZE=true next build --webpack` emits the report to .next/analyze (the plugin is a no-op under Turbopack).
// `npm run analyze` wraps this and the Turbopack-native analyzer (scripts/analyze.mjs).
const analyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true', openAnalyzer: false })

export default analyzer(nextConfig)
