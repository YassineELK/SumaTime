import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['ldapts'],
  poweredByHeader: false,
  // OAuth callback query strings contain short-lived authorization codes.
  logging: { incomingRequests: { ignore: [/^\/api\/auth\/entra\/callback(?:[?]|$)/] } },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'same-origin' },
  ] }, { source: '/api/auth/entra/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }]; },
};

export default nextConfig;
