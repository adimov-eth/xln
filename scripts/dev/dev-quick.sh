#!/bin/bash

echo "[LAUNCH] Quick XLN Development (no network reset)"
echo "   Starting file watcher and server..."

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "[STOP] Stopping development services..."
    pkill -f "bunx serve" 2>/dev/null || true
    pkill -f "dev-watch" 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start file watcher in background
./dev-watch.sh &
WATCH_PID=$!

# Wait for TypeScript to build initially
sleep 3

# Start Svelte dev server
echo "[WEB] Starting Svelte development server..."
cd frontend && npm run dev &
SERVE_PID=$!

sleep 3

echo ""
echo "[OK] Quick Development Ready!"
echo "[WEB] Open: http://localhost:5173 (Svelte frontend)"
echo "[PKG] Auto-compilation: ON"
echo ""
echo "[IDEA] Press Ctrl+C to stop"

# Keep script running
wait $WATCH_PID $SERVE_PID
