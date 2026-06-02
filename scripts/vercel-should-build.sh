#!/usr/bin/env bash
#
# Vercel ignoreCommand. Convention:
#   exit 1 → Vercel proceeds with the build
#   exit 0 → Vercel skips the build (last successful deploy stays live)
#
# This project is hybrid: faculty surfaces (/capture, /explore, /program,
# /admin, /settings, /wiki, /ask, /courses, home) run on a local Mac on
# the Clemson LAN. Only the /partners/* magic-link survey is served by
# Vercel. Vercel still builds the whole Next.js app on every push, which
# means LAN-only changes (chat features, wiki tweaks, scoring prompts)
# fail Vercel builds for code Vercel will never serve.
#
# This script restricts Vercel builds to commits that actually touch
# partner-relevant paths or shared infrastructure that could change how
# /partners renders or runs.
#
# When in doubt, the script falls back to building (exit 1) — better to
# burn a build than silently skip a real /partners change.

set -euo pipefail

# Paths whose changes warrant a Vercel build.
RELEVANT=(
  # /partners surface itself
  'app/partners/'
  'app/api/partners/'
  'app/api/admin/partners/'

  # Shared infra that affects every route
  'middleware.ts'
  'next.config.ts'
  'package.json'
  'pnpm-lock.yaml'
  'tsconfig.json'
  'tailwind.config.*'
  'postcss.config.*'

  # Shared libs partner code depends on
  'lib/db/'
  'lib/ai/provider.ts'
  'lib/ai/openai.ts'
  'lib/ai/function-settings.ts'
  'lib/slug.ts'
  'lib/ip-hash.ts'
  'lib/rate-limit/'
  'drizzle/'

  # Shared UI (partner pages import shadcn primitives, layout, etc.)
  'app/layout.tsx'
  'app/globals.css'
  'components/ui/'

  # This script + Vercel config itself
  'vercel.json'
  'scripts/vercel-should-build.sh'
)

# VERCEL_GIT_PREVIOUS_SHA is set by Vercel for production builds.
# For initial / unknown deploys, fall back to HEAD^ (one commit back).
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [[ -z "${BASE_SHA}" ]]; then
  if git rev-parse HEAD^ >/dev/null 2>&1; then
    BASE_SHA="HEAD^"
  else
    # No parent commit (initial) — always build.
    echo "[vercel-ignore] no parent SHA; proceeding with build"
    exit 1
  fi
fi

# Diff between previous deploy and current HEAD.
CHANGED="$(git diff --name-only "${BASE_SHA}" HEAD 2>/dev/null || true)"

if [[ -z "${CHANGED}" ]]; then
  echo "[vercel-ignore] no file changes detected; proceeding (safe default)"
  exit 1
fi

# If any changed file matches any RELEVANT prefix/glob, build.
for f in ${CHANGED}; do
  for prefix in "${RELEVANT[@]}"; do
    # Support trailing-slash prefix matching and exact / glob matching.
    case "$f" in
      ${prefix}*|${prefix})
        echo "[vercel-ignore] ${f} matched ${prefix} — proceeding with build"
        exit 1
        ;;
    esac
  done
done

echo "[vercel-ignore] no partner-relevant paths changed in ${BASE_SHA}..HEAD — skipping Vercel build"
echo "[vercel-ignore] (LAN-only changes; the Mac-hosted faculty surfaces are unaffected)"
exit 0
