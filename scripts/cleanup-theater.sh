#!/bin/bash

# DELETE THEATRICAL CODE
# This script removes all the architectural theater and keeps only what works

echo "🎭 Removing theatrical transformers..."

# Delete theatrical transformers (keep only base and maybe payment)
rm -f src/transformers/FlashLoanTransformer.ts
rm -f src/transformers/FuturesTransformer.ts
rm -f src/transformers/OptionsTransformer.ts
rm -f src/transformers/InsurancePoolTransformer.ts
rm -f src/transformers/LiquidityPoolTransformer.ts

echo "🎭 Removing fake cross-chain bridge..."
rm -f src/bridges/CrossChainBridge.ts

echo "🎭 Removing overengineered organizational features..."
rm -rf src/organizations/

echo "🎭 Removing theatrical tests..."
rm -f test/integration/bilateral-fixed.test.ts
rm -f test/integration/bilateral-sovereignty.test.ts
rm -f test/integration/complete-system.test.ts

echo "🎭 Removing theatrical demos..."
rm -f demo/bilateral-demo.ts
rm -f examples/organizational-demo.ts

echo "✅ Theatrical code removed. Keeping:"
echo "  - old_src/app/Channel.ts (real bilateral channels)"
echo "  - old_src/app/Transition.ts (real state transitions)"
echo "  - src/RealEntityChannelBridge.ts (actual bridge)"
echo "  - src/fee/FeeMarket.ts (fixed math)"
echo "  - src/merkle/MerkleTree.ts (real proofs)"
echo "  - test/channel-reality.test.ts (tests what works)"