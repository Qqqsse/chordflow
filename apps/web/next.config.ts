import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  // The Docker image build sets NEXT_OUTPUT_STANDALONE=1; local `next start` uses the default output.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: [
    '@chordflow/chart-schema',
    '@chordflow/chordpro',
    '@chordflow/guitar-voicings',
    '@chordflow/music-theory',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: securityHeaders({ development: process.env.NODE_ENV === 'development' }),
      },
      {
        // The service worker must be revalidated on every load so updates roll out.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]);
  },
};

export default nextConfig;
