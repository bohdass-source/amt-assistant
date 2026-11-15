import path from 'node:path';
import type { NextConfig } from 'next';

// In dev, /api is proxied to NestJS. In Docker, Caddy routes /api before it reaches Next.
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
