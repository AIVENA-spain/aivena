#!/usr/bin/env bash
# The ONLY way the dashboard gets deployed to Vercel (Christian's hard rule, 2026-07-15, after a deploy
# from a stale tree briefly rolled back another packet's 15-file Matches redesign).
#
# Enforces, mechanically:
#   1. git fetch origin
#   2. compare this tree against current origin/main
#   3. surface recent dashboard commits from other lanes
#   4/5. REFUSE to deploy unless this tree already contains current origin/main (rebase is a human step —
#        this gate never mutates your branch)
#   6. only then build + deploy
#
# If origin/main has dashboard commits you don't recognise: STOP and report before deploying.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "── deploy gate: fetching origin…"
git fetch origin --quiet

BEHIND=$(git rev-list --count HEAD..origin/main)
AHEAD=$(git rev-list --count origin/main..HEAD)

echo "── tree vs origin/main: ${AHEAD} ahead, ${BEHIND} behind"

if [ "$BEHIND" -ne 0 ]; then
  echo ""
  echo "✗ REFUSED: this tree is ${BEHIND} commit(s) BEHIND origin/main. Deploying now would ship a stale"
  echo "  dashboard and roll back other lanes' live work. The missing commits:"
  echo ""
  git log --oneline HEAD..origin/main
  echo ""
  DASH=$(git diff --name-only HEAD...origin/main -- apps/dashboard | wc -l | tr -d ' ')
  echo "  → ${DASH} of the changed files are in apps/dashboard."
  echo "  → Rebase onto origin/main (resolve consciously), re-verify the build, then run this again."
  echo "  → If any of those commits are dashboard work you don't understand: STOP and report first."
  exit 1
fi

echo "── recent dashboard commits on main (context — know whose work you're shipping):"
git log --oneline -5 origin/main -- apps/dashboard | sed 's/^/    /'

echo "── building dashboard…"
(cd apps/dashboard && npx next build > /tmp/dashboard-build.log 2>&1) || {
  echo "✗ REFUSED: build failed. Last lines:"; tail -5 /tmp/dashboard-build.log; exit 1; }
echo "── build clean. Deploying…"

~/.npm-global/bin/vercel --prod --yes --cwd "$REPO_ROOT/apps/dashboard"

echo "── verifying live surfaces…"
for p in studio overview properties matches settings; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://aivena.es/dashboard/$p")
  echo "    $code /dashboard/$p"
done
echo "── done. Deployed $(git rev-parse --short HEAD) (contains origin/main $(git rev-parse --short origin/main))."
