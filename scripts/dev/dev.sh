#!/bin/bash

echo "[LAUNCH] XLN Development Setup"

# Check if networks are running
echo "1⃣ Checking network status..."
networks_running=0
for port in 8545 8546 8547; do
    if curl -s -X POST -H "Content-Type: application/json" \
       --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
       "http://localhost:$port" > /dev/null 2>&1; then
        echo "   [OK] Network on port $port is running"
        ((networks_running++))
    else
        echo "   [X] Network on port $port is down"
    fi
done

# Start networks if needed
if [ $networks_running -lt 3 ]; then
    echo ""
    echo "2⃣ Starting missing networks..."
    ./start-networks.sh
    echo "   [WAIT] Waiting for networks to stabilize..."
    sleep 5
else
    echo ""
    echo "2⃣ All networks are running [OK]"
fi

# Check jurisdiction configuration
echo ""
echo "3⃣ Checking jurisdiction configuration..."
if [ -f "jurisdictions.json" ]; then
    echo "   [OK] jurisdictions.json exists"
    
    # Check if contracts are deployed (get ethereum entityProvider address)
    ethereum_addr=$(jq -r '.ethereum.contracts.entityProvider // .jurisdictions.ethereum.contracts.entityProvider // "null"' jurisdictions.json 2>/dev/null)
    
    # Check for placeholder/default Hardhat addresses
    default_hardhat="0x5FbDB2315678afecb367f032d93F642f64180aa3"
    
    if [ "$ethereum_addr" = "$default_hardhat" ]; then
        echo "   [WARN]  Using default Hardhat addresses (contracts not deployed)"
        echo "   [DOC] Ethereum: $ethereum_addr"
        echo "   [IDEA] Run './deploy-contracts.sh' to deploy proper contracts"
    elif [ "$ethereum_addr" != "null" ]; then
        echo "   [OK] Contracts deployed to Ethereum"
        echo "   [DOC] Ethereum: $ethereum_addr"
    else
        echo "   [WARN]  Contracts need deployment"
        echo "   [IDEA] Run './deploy-contracts.sh' to deploy"
    fi
else
    echo "   [X] jurisdictions.json missing"
    echo "   [WARN]  Contracts must be deployed first!"
    echo "   [IDEA] Run './deploy-contracts.sh' to deploy and create jurisdictions.json"
    echo "   [BLOCK] Cannot run server without proper contract deployments"
fi

# Check server build
echo ""
echo "4⃣ Checking server build..."
if [ -f "dist/server.js" ]; then
    echo "   [OK] dist/server.js exists"
else
    echo "   [X] dist/server.js missing"
    echo "   [TOOL] Building server..."
    npm run build 2>/dev/null || bun run build 2>/dev/null || echo "   [WARN]  Build failed - check package.json"
fi

echo ""
echo "[GOAL] Development Setup Complete!"
echo ""
echo "[LIST] Quick Commands:"
echo "   • Start server: bun run src/server.ts"
echo "   • Reset everything: ./reset-networks.sh"
echo "   • Deploy contracts: ./deploy-contracts.sh"
echo "   • Start frontend: cd frontend && npm run dev"
echo ""
echo "[WEB] Available at:"
echo "   • Svelte Frontend: http://localhost:5173 (cd frontend && npm run dev)"
echo "   • Server API: http://localhost:8080 (if needed)"
echo ""
echo "[TOOL] Networks:"
echo "   • Ethereum: http://localhost:8545"
echo "   • Polygon: http://localhost:8546"
echo "   • Arbitrum: http://localhost:8547"
