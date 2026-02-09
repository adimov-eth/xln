#!/usr/bin/env bash
set -u
set -o pipefail
IFS=$'\n\t'

RUN_CMD="${RUN_CMD:-}"
while (( "$#" )); do
  case "$1" in
    --run)
      shift
      RUN_CMD="$1"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--run \"command\"]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

mkdir -p logs pids

cleanup() {
  if [ -d pids ]; then
    for f in pids/*.pid; do
      [ -f "$f" ] || continue
      pid=$(cat "$f" 2>/dev/null || true)
      [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
      rm -f "$f" || true
    done
  fi
  pkill -f "hardhat node" 2>/dev/null || true
  pkill -f "runtime/server.ts" 2>/dev/null || true
  pkill -f "ws-server.ts" 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

echo "📦 Installing dependencies..."
bun install
(cd jurisdictions && bun install)

echo "🚀 Starting local chain..."
(cd jurisdictions && bunx hardhat node --port 8545 --hostname 0.0.0.0) > logs/ethereum-8545.log 2>&1 &
echo $! > pids/ethereum.pid

timeout=60
until curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "http://localhost:8545" > /dev/null 2>&1; do
  timeout=$((timeout-2))
  if [ $timeout -le 0 ]; then
    echo "❌ hardhat node failed to start"
    tail -n 200 logs/ethereum-8545.log || true
    exit 1
  fi
  sleep 2
done
echo "✅ RPC ready on 8545"

echo "🔧 Building contracts + bytecode gate..."
bun run env:build
bun run size:check

echo "🌐 Starting runtime server..."
USE_ANVIL=true ANVIL_RPC=http://localhost:8545 RELAY_URL=ws://localhost:9000 bun runtime/server.ts --port 8080 > logs/runtime-server.log 2>&1 &
echo $! > pids/runtime.pid

echo "🔌 Starting relay..."
bun runtime/networking/ws-server.ts --port 9000 > logs/relay.log 2>&1 &
echo $! > pids/relay.pid

timeout=90
until curl -sf "http://localhost:8080/api/health" >/dev/null 2>&1; do
  timeout=$((timeout-2))
  if [ $timeout -le 0 ]; then
    echo "❌ runtime server failed health check"
    tail -n 200 logs/runtime-server.log || true
    exit 1
  fi
  sleep 2
done
echo "✅ Runtime API ready on :8080"

if [ -n "$RUN_CMD" ]; then
  echo "🧪 Running command: $RUN_CMD"
  eval "$RUN_CMD"
  rc=$?
  cleanup
  exit $rc
fi

if [ "${CI:-}" = "true" ]; then
  echo "🤖 CI mode: services started"
  exit 0
fi

echo "💡 Press Ctrl+C to stop services"
wait
