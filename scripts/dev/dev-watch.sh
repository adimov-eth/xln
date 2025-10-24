#!/bin/bash

# Development watch script for XLN consensus debugging
# Compiles TypeScript to JavaScript on-the-fly and serves files

echo "[ANTICLOCKWISE] Starting XLN development watch mode..."

# Kill any existing processes
pkill -f "bun build.*watch" || true
pkill -f "bun.*server" || true
pkill -f "fswatch" || true

# Create dist directory
mkdir -p dist

# Function to show rebuild notification
show_rebuild() {
    echo ""
    echo "[ANTICLOCKWISE] $(date '+%H:%M:%S') - Rebuilding server.ts..."
    echo "[FAST] Changes detected, compiling..."
}

# Function to show rebuild complete
show_rebuild_complete() {
    echo "[OK] $(date '+%H:%M:%S') - Server rebuilt successfully!"
    echo "[LAUNCH] Latest version ready at http://localhost:8080"
    echo ""
}

# Start TypeScript watch compilation with enhanced logging
echo "[PKG] Starting TypeScript watch compilation..."

# Initial build with notification
show_rebuild
bun build src/server.ts --target=browser --outdir=dist --minify --external http --external https --external zlib --external fs --external path --external crypto --external stream --external buffer --external url --external net --external tls --external os --external util
if [ $? -eq 0 ]; then
    cp dist/server.js frontend/static/server.js
    show_rebuild_complete
else
    echo "[X] $(date '+%H:%M:%S') - Build failed!"
    echo ""
fi

# Start file watcher for continuous rebuilds
if command -v fswatch >/dev/null 2>&1; then
    # Use fswatch if available (more reliable)
    fswatch -o src/server.ts src/state-encoder.ts src/state-serde.ts src/snapshot-coder.ts 2>/dev/null | while read num; do
        show_rebuild
        bun build src/server.ts --target=browser --outdir=dist --minify --external http --external https --external zlib --external fs --external path --external crypto --external stream --external buffer --external url --external net --external tls --external os --external util
        if [ $? -eq 0 ]; then
            cp dist/server.js frontend/static/server.js
            show_rebuild_complete
        else
            echo "[X] $(date '+%H:%M:%S') - Build failed!"
            echo ""
        fi
    done &
    WATCH_PID=$!
    echo "[FOLDER] Using fswatch for file monitoring"
else
    # Fallback to bun's built-in watch with custom monitoring
    (
        bun build src/server.ts --target=browser --outdir=dist --minify --external http --external https --external zlib --external fs --external path --external crypto --external stream --external buffer --external url --external net --external tls --external os --external util --watch 2>&1 | while IFS= read -r line; do
            if [[ "$line" == *"[watch]"* ]] || [[ "$line" == *"Rebuilt"* ]] || [[ "$line" == *"Built"* ]]; then
                cp dist/server.js frontend/static/server.js 2>/dev/null
                show_rebuild_complete
            fi
            echo "$line"
        done
    ) &
    WATCH_PID=$!
    echo "[FOLDER] Using bun's built-in watch mode"
fi

# Note: This script now only handles TypeScript compilation
# For the frontend, run: cd frontend && npm run dev
echo "[MEMO] Note: TypeScript compilation only - for frontend run: cd frontend && npm run dev"
SERVER_PID=""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "[STOP] Stopping development server..."
    kill $WATCH_PID $SERVER_PID 2>/dev/null || true
    pkill -f "fswatch" 2>/dev/null || true
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "[OK] Development environment ready!"
echo "   [PKG] TypeScript compilation: watching src/server.ts + dependencies"
echo "   [WEB] Development server: http://localhost:8080"
echo "   [DOC] Open browser to see debugging interface"
echo "   [ANTICLOCKWISE] Files will auto-reload on changes with timestamp notifications"
echo ""
echo "� Look for rebuild messages with timestamps when you save files"
echo "Press Ctrl+C to stop..."

# Wait for processes
wait $WATCH_PID $SERVER_PID
