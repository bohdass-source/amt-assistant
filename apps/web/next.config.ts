import path from 'node:path';
import type { NextConfig } from 'next';

// В dev /api проксируется на NestJS. В Docker /api до Next не доходит — его забирает Caddy.
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
