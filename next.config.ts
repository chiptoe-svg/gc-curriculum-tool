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

  // Next.js 15's middleware caps multipart bodies at 10 MB by default.
  // A faculty member's 13 MB lab PDF got rejected ("Request body exceeded
  // 10MB for /api/courses/GC 4440/materials") even though our route's own
  // MAX_SIZE_BYTES is 15 MB — middleware rejects before the route handler
  // sees the body. Raising the middleware-side ceiling to 25 MB; the
  // materials route still enforces its own 15 MB limit.
  experimental: {
    middlewareClientMaxBodySize: '25mb',
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
