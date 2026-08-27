#!/usr/bin/env bash
# Canonical setup for a fresh, isolated checkout of ContactLogo (Claude Code
# cloud/remote sandbox, Codespaces, devcontainer, or any throwaway clone).
# Idempotent — safe to re-run.
#
# Claude Code Cloud runs the Setup script from the PARENT of the clone
# (`/home/user`). A bare `bash scripts/cloud-setup.sh` fails with exit 127.
# Use the fleet locator in ai-fleet-coordinator/docs/CLAUDE-CODE-CLOUD-ENVIRONMENTS.md
# or: cd ContactLogo && bash scripts/cloud-setup.sh
#
# The web app lives in web/. Swift/Xcode is not available in the Linux cloud VM.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Node: $(node --version 2>/dev/null || echo 'not found')  npm: $(npm --version 2>/dev/null || echo 'not found')"
echo "==> Installing web dependencies (npm ci --include=dev)"
npm ci --include=dev --prefix web

echo "==> Setup complete."
echo "    Dev:     npm run dev"
echo "    Verify:  npm run typecheck && npm test"
