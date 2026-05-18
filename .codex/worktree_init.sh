#!/usr/bin/env bash
set -eo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install it via 'corepack enable' or https://pnpm.io/installation" >&2
  exit 1
fi

cd "$repo_root"
pnpm install
