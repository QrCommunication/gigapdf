import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@giga-pdf/ui", "@giga-pdf/types", "@giga-pdf/api"],
  // Exclude Node.js-only packages from client bundle
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "@prisma/client", "nodemailer"],
  // Force dynamic rendering to avoid SSG issues with client components
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Disable static generation for error pages
  experimental: {
    // Use PPR for better static/dynamic mix
    ppr: false,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // Proxy API calls to avoid mixed content (HTTPS frontend -> HTTP backend)
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        // Proxy /backend-api/v1/* to http://localhost:8000/api/v1/*
        source: "/backend-api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
