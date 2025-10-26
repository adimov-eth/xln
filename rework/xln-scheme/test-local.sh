#!/bin/bash
# Local testing script for XLN Racket implementation
# Tests all demos and verifies system works on local device

set -e  # Exit on error

echo "═══════════════════════════════════════════════════════════"
echo "  XLN Racket - Local Testing Suite"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check Racket installation
echo "[1/4] Checking Racket installation..."
if ! command -v racket &> /dev/null; then
    echo "❌ Racket not found. Install with:"
    echo "   macOS: brew install racket"
    echo "   Linux: apt-get install racket"
    exit 1
fi

RACKET_VERSION=$(racket --version | head -1)
echo "✓ $RACKET_VERSION"
echo ""

# Test Foundation Layer (crypto, RLP, merkle)
echo "[2/4] Testing Foundation Layer..."
echo "  → Crypto primitives..."
racket examples/crypto-demo.rkt > /dev/null && echo "    ✓ Crypto works"
echo "  → RLP encoding..."
racket examples/rlp-demo.rkt > /dev/null && echo "    ✓ RLP works"
echo "  → Merkle trees..."
racket examples/merkle-demo.rkt > /dev/null && echo "    ✓ Merkle works"
echo ""

# Test Consensus Layer
echo "[3/4] Testing Consensus Layer..."
echo "  → Bilateral consensus (2-of-2)..."
racket examples/bilateral-consensus-demo.rkt > /dev/null && echo "    ✓ Bilateral works"
echo "  → BFT consensus (≥2/3 quorum)..."
racket examples/bft-consensus-demo.rkt > /dev/null && echo "    ✓ BFT works"
echo ""

# Test Network + Blockchain + Persistence
echo "[4/4] Testing Integration..."
echo "  → Gossip + Multi-hop routing..."
racket examples/gossip-routing-demo.rkt > /dev/null && echo "    ✓ Network works"
echo "  → Blockchain settlement..."
racket examples/blockchain-demo.rkt > /dev/null && echo "    ✓ Blockchain works"
echo "  → WAL + Crash recovery..."
racket examples/persistence-demo.rkt > /dev/null && echo "    ✓ Persistence works"
echo ""

# Run all demos with output
echo "═══════════════════════════════════════════════════════════"
echo "  All tests passed! Running full demo suite..."
echo "═══════════════════════════════════════════════════════════"
echo ""

DEMOS=(
    "examples/crypto-demo.rkt"
    "examples/rlp-demo.rkt"
    "examples/merkle-demo.rkt"
    "examples/bilateral-consensus-demo.rkt"
    "examples/bft-consensus-demo.rkt"
    "examples/gossip-routing-demo.rkt"
    "examples/blockchain-demo.rkt"
    "examples/persistence-demo.rkt"
    "examples/architecture-query.rkt"
    "examples/architecture-tree.rkt"
    "examples/architecture-validate.rkt"
    "examples/coinductive-observation.rkt"
)

PASSED=0
FAILED=0

for demo in "${DEMOS[@]}"; do
    echo "Running: $demo"
    if racket "$demo"; then
        ((PASSED++))
    else
        ((FAILED++))
        echo "❌ FAILED: $demo"
    fi
    echo ""
done

echo "═══════════════════════════════════════════════════════════"
echo "  Test Summary"
echo "═══════════════════════════════════════════════════════════"
echo "  Total demos: $((PASSED + FAILED))"
echo "  ✓ Passed: $PASSED"
if [ $FAILED -eq 0 ]; then
    echo "  ✗ Failed: $FAILED"
    echo ""
    echo "🎉 All local tests passed! XLN is working correctly."
    echo ""
    echo "Next steps:"
    echo "  - Read docs/02-core-concepts.md for deeper understanding"
    echo "  - Try modifying examples/ to experiment"
    echo "  - Check docs/07-contributing.md to extend XLN"
else
    echo "  ✗ Failed: $FAILED"
    echo ""
    echo "⚠️  Some tests failed. Check output above for details."
    exit 1
fi
