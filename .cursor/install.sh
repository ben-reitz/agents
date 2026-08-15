#!/usr/bin/env bash
#
# Cloud Agent bootstrap for the Cloudflare Agents SDK monorepo.
#
# Runs after the repository is checked out. Must be idempotent: it can run
# repeatedly and against a cached/partially-prepared workspace. It prepares a
# fully usable dev environment (Node 24, dependencies, build output, and the
# Playwright browser used by the workers-runtime browser tests).
set -euo pipefail

# The repo requires Node >= 24 (see AGENTS.md). The base image ships an older
# Node earlier in PATH, so we install and select Node 24 via nvm and prepend
# its bin dir for every command this script runs. Downstream commands that need
# Node 24 should likewise `nvm use 24` or prepend this bin dir.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 24
nvm alias default 24 >/dev/null
nvm use 24 >/dev/null
export PATH="$(nvm which 24 | xargs dirname):$PATH"

node -v
corepack enable
corepack prepare pnpm@11.9.0 --activate

# Optional native dependency `node-liblzma` (pulled in transitively by
# `just-bash`) needs liblzma headers + pkg-config to compile. It is an optional
# dependency, so treat this best-effort — install failures must not break setup.
if ! pkg-config --exists liblzma 2>/dev/null; then
  sudo apt-get update -qq || true
  sudo apt-get install -y -qq liblzma-dev pkg-config || true
fi

# Install workspace dependencies from the committed lockfile.
pnpm install --frozen-lockfile

# Build the optional native module now that its system deps exist (best-effort).
pnpm rebuild node-liblzma || true

# Build all packages so the `agents` CLI and other dist output exist (examples
# and workspace bins resolve against these).
pnpm run build

# Install the Chromium build used by the vitest workers-runtime browser tests
# (`packages/agents` / `@cloudflare/ai-chat`) and computer-use flows.
pnpm run prepare:playwright
