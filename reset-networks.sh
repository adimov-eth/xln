#!/bin/bash

echo "[ANTICLOCKWISE] Resetting XLN Network (Ethereum only) and Redeploying Contracts..."

# Stop existing networks
echo "1⃣ Stopping existing networks..."
./scripts/dev/stop-networks.sh

# Clean up old data
echo ""
echo "2⃣ Cleaning up old data..."
rm -rf jurisdictions/ignition/deployments/* 2>/dev/null || true
rm -rf jurisdictions/cache/ 2>/dev/null || true
rm -rf jurisdictions/artifacts/ 2>/dev/null || true
rm -rf jurisdictions/typechain-types/ 2>/dev/null || true
rm -rf logs/*.log 2>/dev/null || true
rm -rf db 2>/dev/null || true
echo "[OK] Cleanup complete (cleared ignition, hardhat cache, artifacts)"

# Start fresh networks
echo ""
echo "3⃣ Starting fresh networks..."
./scripts/dev/start-networks.sh

# Wait for networks to stabilize
echo ""
echo "4⃣ Waiting for networks to stabilize..."
sleep 5

# Deploy contracts using dedicated script
echo ""
echo "5⃣ Deploying contracts..."
./deploy-contracts.sh

if [ $? -eq 0 ]; then
    echo ""
    echo "[DONE] Network reset complete!"
    echo ""
    echo "[OK] Ethereum network running with fresh contracts"
    echo "[LIST] Contract addresses saved to jurisdictions.json"
    echo ""
    echo "[LAUNCH] Next steps:"
    echo "   • Run: bun run runtime/runtime.ts"
    echo "   • Open: index.html"
    echo "   • Test: Create entities and check Jurisdictions tab"
    echo ""
    echo "[MEMO] View logs: ls -la logs/"
else
    echo ""
    echo "[X] Contract deployment failed!"
    echo "[LIST] Check logs for details and try again"
    exit 1
fi 