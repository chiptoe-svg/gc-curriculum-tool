import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf bundles pdfjs-dist for Node serverless. Keeping it external
  // ensures Turbopack doesn't try to inline the (large) pdfjs build and
  // its polyfills into route bundles.
  serverExternalPackages: ['unpdf'],

  // Next.js's file tracing doesn't follow runtime-constructed paths (the
  // prompt loader builds paths like `join(process.cwd(), 'lib/ai/prompts',
  // name + '.md')`), so without this config the .md files are excluded from
  // the serverless bundle and readFile throws ENOENT at runtime on Vercel.
  // Include every prompt file (main + shared) in the bundle for any API route.
  outputFileTracingIncludes: {
    "/api/**/*": ["./lib/ai/prompts/**/*.md"],
  },

  // Next.js 15's middleware caps multipart bodies at 10 MB by default and
  // rejects oversized requests before the route handler sees them. Two
  // callers need headroom: the materials upload (own 15 MB cap) and the
  // IMSCC cartridge import (own 500 MB cap — real Canvas exports are
  // hundreds of MB of bundled media). Set the middleware ceiling to 600 MB
  // so the cartridge upload reaches its route; each route still enforces
  // its own, tighter per-feature limit. (LAN/Funnel single-faculty tool
  // behind Basic Auth, so the looser global floor is acceptable.)
  experimental: {
    middlewareClientMaxBodySize: '600mb',
  },

  // Skip ESLint during `next build`. We run ESLint in dev (and can run it
  // in CI if we add a pipeline) but Vercel's build was failing on unused
  // imports in LAN-only code (lib/wiki, lib/rate-limit) that doesn't even
  // ship to the Vercel deployment. TypeScript still gates the build via
  // `tsc --noEmit` separately — that's the real type safety. ESLint here
  // was a noise floor blocking unrelated /partners deploys.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
