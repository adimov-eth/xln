#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

echo "🚀 XLN kernel development environment"
echo "   (contracts + runtime server + relay, no frontend)"

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ bun is required"
  exit 1
fi

echo "📦 Installing dependencies..."
bun install
(cd jurisdictions && bun install)

echo "🔧 Building contracts..."
bun run env:build

echo "✅ Starting kernel stack..."
exec bun run dev
