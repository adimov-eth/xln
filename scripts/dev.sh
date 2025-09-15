#!/bin/bash
# Unified development script

case "$1" in
    quick)
        bun src/server.ts
        ;;
    watch)
        bun --watch src/server.ts
        ;;
    full)
        npm run build && npm run serve
        ;;
    ci)
        npm run lint && npm test
        ;;
    *)
        echo "Usage: $0 {quick|watch|full|ci}"
        exit 1
        ;;
esac
