#!/usr/bin/env bash
# Gart installer launcher for macOS and Linux.
# Checks Node.js, then starts the local web wizard (installer/install.mjs).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Install Node.js 22.12 or newer from https://nodejs.org and run this script again."
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
minor="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; }; then
  echo "Node.js $(node -v) is too old. Version 22.12 or newer is required (https://nodejs.org)."
  exit 1
fi

exec node installer/install.mjs "$@"
