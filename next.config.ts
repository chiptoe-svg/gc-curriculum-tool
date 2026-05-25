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
};

export default nextConfig;
