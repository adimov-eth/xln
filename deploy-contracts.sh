#!/usr/bin/env bash
set -u
set -o pipefail
IFS=$'\n\t'

echo "[MEMO] Deploying EntityProvider contracts to all networks..."

# Create deployment log directory
mkdir -p logs

# Network configurations (using simple variables instead of associative arrays)
NETWORK_8545="Ethereum"
NETWORK_8546="Polygon"
NETWORK_8547="Arbitrum"

# Store contract addresses in files
CONTRACT_8545=""
CONTRACT_8546=""
CONTRACT_8547=""

deploy_to_network() {
    local port=$1
    local network_name=$2
    local network_config=""

    # Map port to network config name
    case $port in
        8545) network_config="ethereum" ;;
        8546) network_config="polygon" ;;
        8547) network_config="arbitrum" ;;
        *) echo "   [X] Unknown port: $port"; return 1 ;;
    esac

    local rpc_url="http://localhost:$port"

    echo ""
    echo "[ANTICLOCKWISE] Deploying to $network_name (port $port)..."

    # Check if network is available, retry for up to 30s
    local tries=0
    local max_tries=10
    local ok=1
    while [ $tries -lt $max_tries ]; do
        if curl -s -X POST -H "Content-Type: application/json" \
             --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
             "$rpc_url" > /dev/null 2>&1; then
            ok=0
            break
        fi
        tries=$((tries+1))
        sleep 3
    done
    if [ $ok -ne 0 ]; then
        echo "   [X] Network not available at $rpc_url after $((max_tries*3))s"
        return 1
    fi

    cd jurisdictions

    # Ensure logs directory exists
    mkdir -p ../logs
    
    # COMPREHENSIVE cache clearing for this network
    echo "   [CLEAN] Clearing ALL caches for $network_name..."
    rm -rf cache/ 2>/dev/null || true
    rm -rf artifacts/ 2>/dev/null || true
    rm -rf typechain-types/ 2>/dev/null || true
    rm -rf ignition/deployments/chain-1337/ 2>/dev/null || true
    echo "   [OK] All caches cleared"
    
    # Force fresh compilation with typechain
    echo "   [TOOL] Compiling contracts and generating TypeChain types..."
    if ! npx hardhat compile --force 2>&1; then
        echo "   [X] Contract compilation failed"
        cd ..
        return 1
    fi

    # TypeChain types are automatically generated during compilation with hardhat-toolbox
    echo "   [TOOL] TypeChain types generated automatically during compilation"

    # Verify TypeChain types were generated
    if [ -d "typechain-types" ]; then
        echo "   [OK] TypeChain types directory exists"
        # Check if index file exists and create it if missing
        if [ ! -f "typechain-types/index.ts" ]; then
            echo "   [TOOL] Creating missing TypeChain index.ts..."
            echo 'export * from "./contracts";' > typechain-types/index.ts
        fi
    else
        echo "   [WARN] TypeChain types directory missing, but continuing..."
    fi

    # Run tests before deployment
    echo "   [TEST] Running contract tests before deployment..."
    echo "   [FIND] Running EntityProvider tests..."
    if ls test/EntityProvider* >/dev/null 2>&1; then
        if ! npx hardhat test test/EntityProvider* --network hardhat 2>&1 | tee "../logs/test-entityprovider-$port.log"; then
            echo "   [X] EntityProvider tests failed! Stopping deployment."
            cd ..
            return 1
        fi
        echo "   [OK] EntityProvider tests passed"
    else
        echo "   [IDEA] EntityProvider tests not found, skipping..."
    fi

    # Skip Depository unit tests for now - use R2R smoke test instead
    echo "   [IDEA] Skipping Depository unit tests (use R2R smoke test for verification)"
    
    # Verify critical functions are in compiled ABI
    echo "   [FIND] Verifying critical functions in compiled ABI..."
    if grep -q "debugBulkFundEntities" artifacts/contracts/Depository.sol/Depository.json 2>/dev/null; then
        echo "   [OK] debugBulkFundEntities function found in compiled ABI"
    else
        echo "   [X] debugBulkFundEntities function missing from compiled ABI"
        cd ..
        return 1
    fi

    if grep -q "processBatch" artifacts/contracts/Depository.sol/Depository.json 2>/dev/null; then
        echo "   [OK] processBatch function found in compiled ABI"
    else
        echo "   [X] processBatch function missing from compiled ABI"
        echo "   [FIND] This explains the R2R transaction failures!"
        cd ..
        return 1
    fi

    if grep -q "settle" artifacts/contracts/Depository.sol/Depository.json 2>/dev/null; then
        echo "   [OK] settle function found in compiled ABI"
    else
        echo "   [X] settle function missing from compiled ABI"
        cd ..
        return 1
    fi

    # Verify script exists before attempting deployment
    if [ ! -f "scripts/deploy-entity-provider.cjs" ]; then
        echo "   [X] scripts/deploy-entity-provider.cjs not found in $(pwd)"
        echo "   [FOLDER] Contents of scripts directory:"
        ls -la scripts/ || echo "   scripts/ directory not found"
        cd ..
        return 1
    fi

    # Deploy both EntityProvider and Depository
    echo "   [TOOL] Deploying EntityProvider..."
    # Run deployment and capture logs
    if ! entityprovider_output=$(bunx hardhat run scripts/deploy-entity-provider.cjs --network "$network_config" 2>&1); then
        echo "   [X] EntityProvider deployment failed"
        echo "$entityprovider_output"
        echo "$entityprovider_output" > "../logs/deploy-entityprovider-$port.log" 2>/dev/null || true
        cd ..
        return 1
    fi
    echo "$entityprovider_output" > "../logs/deploy-entityprovider-$port.log" 2>/dev/null || true

    if ! echo "$entityprovider_output" | grep -q "DEPLOYED_ADDRESS="; then
        echo "   [X] EntityProvider deployment did not return DEPLOYED_ADDRESS"
        cd ..
        return 1
    fi
    # Extract EntityProvider address
    local entityprovider_address
    entityprovider_address=$(echo "$entityprovider_output" | grep "DEPLOYED_ADDRESS=" | cut -d'=' -f2)
    echo "   [OK] EntityProvider: $entityprovider_address"

    echo "   [TOOL] Deploying Depository..."
    # Deploy Depository using ignition; accept prompts if any
    if ! depository_output=$(printf "y\n" | bunx hardhat ignition deploy ignition/modules/Depository.cjs --network "$network_config" 2>&1); then
        echo "   [X] Depository deployment failed"
        echo "$depository_output"
        echo "$depository_output" > "../logs/deploy-depository-$port.log" 2>/dev/null || true
        cd ..
        return 1
    fi
    echo "$depository_output" > "../logs/deploy-depository-$port.log" 2>/dev/null || true
    
    # Wait for ignition to create deployment artifacts
    local deployment_file="ignition/deployments/chain-1337/deployed_addresses.json"
    echo "   [FIND] Waiting for deployment file: $deployment_file"
    local tries=0
    while [ ! -f "$deployment_file" ] && [ $tries -lt 10 ]; do
        sleep 1
        tries=$((tries+1))
        echo "   [WAIT] Waiting for deployment file... (try $tries/10)"
    done
    
    # Extract Depository address from deployed_addresses.json
    local depository_address
    if [ -f "$deployment_file" ]; then
        echo "   [OK] Deployment file found, extracting addresses..."
        cat "$deployment_file"
        depository_address=$(jq -r '.["DepositoryModule#Depository"]' "$deployment_file" 2>/dev/null || true)
        echo "   [FIND] Extracted Depository: $depository_address"
    else
        echo "   [X] Deployment file not found after waiting"
    fi
    if [ -z "$depository_address" ] || [ "$depository_address" = "null" ]; then
        # Fallback to old method
        depository_address=$(echo "$depository_output" | grep -o '0x[a-fA-F0-9]\{40\}' | tail -1 || true)
        echo "   [FIND] Fallback extraction: $depository_address"
    fi
    if [ -z "$depository_address" ] || [ "$depository_address" = "null" ]; then
        echo "   [X] Could not extract Depository address"
        return 1
    fi
    echo "   [OK] Depository: $depository_address"

    # CRITICAL: Verify processBatch function exists in deployed contract
    echo "   [ALERT] CRITICAL: Verifying processBatch function in deployed contract..."
    echo "   [FIND] Using freshly deployed address: $depository_address"

    # Pass the address to verification script
    export DEPOSITORY_ADDRESS="$depository_address"
    if ! verification_output=$(bunx hardhat run scripts/verify-contract-functions.cjs --network "$network_config" 2>&1); then
        echo "   [X] CRITICAL: Contract verification script FAILED!"
        echo "$verification_output"
        echo "   [BLOCK] DEPLOYMENT FAILED - Cannot verify deployed contract"
        cd ..
        return 1
    fi

    echo "$verification_output"
    if echo "$verification_output" | grep -q "[X].*MISSING"; then
        echo "   [X] CRITICAL: Essential functions MISSING from deployed contract!"
        echo "   [BLOCK] DEPLOYMENT FAILED - Contract is broken"
        cd ..
        return 1
    fi

    if echo "$verification_output" | grep -q "[OK] ALL CRITICAL FUNCTIONS VERIFIED"; then
        echo "   [OK] CRITICAL: All functions verified in deployed contract"
    else
        echo "   [X] CRITICAL: Function verification FAILED!"
        echo "   [BLOCK] DEPLOYMENT FAILED - Contract incomplete"
        cd ..
        return 1
    fi

    # CRITICAL: Run R2R smoke test - FAIL deployment if it doesn't work
    echo "   [TEST] Running CRITICAL Reserve-to-Reserve (R2R) smoke test..."
    echo "   [ALERT] This test MUST PASS or deployment will FAIL"
    if ! bunx hardhat run test-r2r-post-deployment.cjs --network "$network_config" 2>&1; then
        echo "   [X] CRITICAL: R2R smoke test FAILED!"
        echo "   [BLOCK] DEPLOYMENT FAILED - R2R functionality broken"
        echo "   [IDEA] This means the UI won't work with these contracts"
        cd ..
        return 1
    fi
    echo "   [OK] CRITICAL: R2R smoke test PASSED - Contracts fully functional"

    # Build and update frontend bundle with latest runtime.js
    echo "   [TOOL] Updating frontend bundle with latest runtime code..."
    cd ..
    if bun build runtime/runtime.ts --target=browser --outdir=dist --minify --external http --external https --external zlib --external fs --external path --external crypto --external stream --external buffer --external url --external net --external tls --external os --external util; then
        echo "   [OK] Runtime built successfully"
        if cp dist/runtime.js frontend/static/runtime.js; then
            echo "   [OK] Frontend bundle updated with latest runtime.js"
        else
            echo "   [WARN] Failed to copy runtime.js to frontend (continuing anyway)"
        fi
    else
        echo "   [WARN] Runtime build failed (continuing anyway)"
    fi
    cd jurisdictions

    # Store both addresses in variables for later use
    case $port in
        8545)
            CONTRACT_8545_EP="$entityprovider_address"
            CONTRACT_8545_DEP="$depository_address"
            ;;
        8546)
            CONTRACT_8546_EP="$entityprovider_address"
            CONTRACT_8546_DEP="$depository_address"
            ;;
        8547)
            CONTRACT_8547_EP="$entityprovider_address"
            CONTRACT_8547_DEP="$depository_address"
            ;;
    esac

    echo "   [OK] $network_name deployment complete"

    cd ..
    return 0
}

# Deploy to all networks
success_count=0

if deploy_to_network "8545" "$NETWORK_8545"; then
    ((success_count++))
fi

# COMMENTED OUT: Focus on Ethereum only for now
# if deploy_to_network "8546" "$NETWORK_8546"; then
#     ((success_count++))
# fi

# if deploy_to_network "8547" "$NETWORK_8547"; then
#     ((success_count++))
# fi

echo ""
echo "[STATS] Deployment Summary:"
echo "   [OK] Successful: $success_count/1 networks (Ethereum only)"

if [ $success_count -gt 0 ]; then
    echo ""
    echo "[PIN] Contract Addresses:"

    if [ -n "$CONTRACT_8545_EP" ]; then
        echo "   $NETWORK_8545 (port 8545):"
        echo "     EntityProvider: $CONTRACT_8545_EP"
        echo "     Depository: $CONTRACT_8545_DEP"
    fi

    # Update server configuration
    echo ""
    echo "[TOOL] Creating unified jurisdiction configuration..."
    
    # DEBUG: Show what variables we actually have (Ethereum only)
    echo "[FIND] DEBUG: Contract variables before jurisdictions.json generation:"
    echo "   CONTRACT_8545_EP='$CONTRACT_8545_EP'"
    echo "   CONTRACT_8545_DEP='$CONTRACT_8545_DEP'"
    echo ""

    # Create fresh jurisdictions.json with Arrakis and Wakanda
    # Use /rpc/* proxy paths for HTTPS [RIGHTWARDS] HTTP proxying (eliminates SSL errors)
    cat > jurisdictions.json << EOF
{
  "version": "2.0.0",
  "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "jurisdictions": {
    "arrakis": {
      "name": "Arrakis",
      "chainId": 1337,
      "rpc": "/rpc/arrakis",
      "contracts": {
        "entityProvider": "$CONTRACT_8545_EP",
        "depository": "$CONTRACT_8545_DEP"
      },
      "explorer": "http://localhost:8545",
      "currency": "SPICE",
      "status": "active",
      "description": "The desert planet - strategic resource hub, high-value trade"
    },
    "wakanda": {
      "name": "Wakanda",
      "chainId": 1338,
      "rpc": "/rpc/wakanda",
      "contracts": {
        "entityProvider": "$CONTRACT_8545_EP",
        "depository": "$CONTRACT_8545_DEP"
      },
      "explorer": "http://localhost:8546",
      "currency": "VIBRANIUM",
      "status": "pending",
      "description": "Advanced technology, sovereign nation, vibranium-backed reserves (Coming Soon)"
    }
  },
  "defaults": {
    "timeout": 30000,
    "retryAttempts": 3,
    "gasLimit": 1000000
  }
}
EOF

    echo "   [OK] Created fresh jurisdictions.json with:"
    echo "     Arrakis (port 8545): EntityProvider=$CONTRACT_8545_EP, Depository=$CONTRACT_8545_DEP"
    echo "     Wakanda (port 8546): Coming soon (same contracts for now)"



    echo "   [OK] Unified jurisdictions configuration saved"

    # Update ALL jurisdiction files to prevent sync issues
    echo "   [ANTICLOCKWISE] Syncing jurisdictions to all frontend locations..."
    cp jurisdictions.json frontend/static/jurisdictions.json 2>/dev/null || true
    cp jurisdictions.json frontend/build/jurisdictions.json 2>/dev/null || true
    if [ -f "frontend/.svelte-kit/output/client/jurisdictions.json" ]; then
        cp jurisdictions.json frontend/.svelte-kit/output/client/jurisdictions.json 2>/dev/null || true
        echo "   [OK] Updated SvelteKit output file"
    fi
    echo "   [OK] All jurisdiction files synchronized"
    echo ""
    echo "[GOAL] Deployment complete!"
    echo "[LIST] Next: Restart server to use new contracts"

else
    echo ""
    echo "[X] No successful deployments. Check network status and try again."
    exit 1
fi