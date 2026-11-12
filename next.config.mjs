/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/agent reads the repo itself (lockfile, src/features, advisory snapshots).
  // Next only bundles files a route imports, so list the ones it reads from disk.
  outputFileTracingIncludes: {
    '/api/agent': ['./package.json', './package-lock.json', './src/**/*.{ts,tsx}', './agents/sentinel-scout/snapshots/**/*'],
  },
}

export default nextConfig
