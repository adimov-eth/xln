#!/bin/bash
# Frontend-only dev (no blockchain) - useful if you just want to work on UI

echo "[DESIGN] Starting Frontend-Only Development"
echo "   (No blockchain - using mock data)"
echo ""

# Check if deps installed
if [ ! -d "node_modules" ]; then
    echo "[PKG] Installing dependencies..."
    bun install
fi

# Set flag to skip blockchain features
export NO_BLOCKCHAIN=1

echo "[WEB] Starting Vite..."
bun --bun run dev

