#!/bin/bash

echo "[LAUNCH] Starting XLN Demo Networks..."

# Create directories for logs and pids first
mkdir -p logs pids

# Kill any existing hardhat nodes
pkill -f "hardhat node" 2>/dev/null || true

# Wait a bit for cleanup
sleep 1

# Start three hardhat nodes in background
echo "[ANTENNA] Starting Ethereum Network (port 8545)..."
cd jurisdictions && bunx hardhat node --port 8545 --hostname 127.0.0.1 > ../logs/ethereum-8545.log 2>&1 &
echo "$!" > pids/ethereum.pid

# COMMENTED OUT: Focus on Ethereum only
# echo "[ANTENNA] Starting Polygon Network (port 8546)..."
# cd jurisdictions && bunx hardhat node --port 8546 --hostname 127.0.0.1 > ../logs/polygon-8546.log 2>&1 &
# echo "$!" > pids/polygon.pid

# echo "[ANTENNA] Starting Arbitrum Network (port 8547)..."
# cd jurisdictions && bunx hardhat node --port 8547 --hostname 127.0.0.1 > ../logs/arbitrum-8547.log 2>&1 &
# echo "$!" > pids/arbitrum.pid

cd ..

echo "[WAIT] Waiting for networks to start..."
sleep 3

# Check if networks are responding
check_network() {
    curl -s -X POST -H "Content-Type: application/json" \
         --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
         http://localhost:$1 > /dev/null 2>&1
    return $?
}

echo "[FIND] Checking network status..."
if check_network 8545; then
    echo "[OK] Network on port 8545 is running"
else
    echo "[X] Network on port 8545 failed to start"
    exit 1
fi

echo ""
echo "[GOAL] Ethereum network started!"
echo "   Ethereum: http://localhost:8545"
echo ""
echo "[MEMO] Logs available in logs/ directory"
echo "[STOP] Use './stop-networks.sh' to stop all networks" 