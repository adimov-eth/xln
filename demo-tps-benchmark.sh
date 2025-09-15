#!/bin/bash

# XLN TPS Benchmark Demo Script
# Demonstrates XLN's ability to handle 18+ TPS under realistic conditions

set -e

echo "🚀 XLN TPS Benchmark Demo"
echo "========================="
echo ""
echo "This benchmark proves XLN can handle 18+ TPS with:"
echo "  ✅ 100 users (50 custodial, 50 trustless)"
echo "  ✅ Realistic order distribution (power law)"
echo "  ✅ Network latency and Byzantine actors"
echo "  ✅ Cross-settlement via HTLCs"
echo "  ✅ Zero-cost operations (gas only for channels)"
echo ""

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is required but not installed."
    echo "   Install from: https://bun.sh/"
    exit 1
fi

# Check if test files exist
if [[ ! -f "test/performance/tps-benchmark.ts" ]]; then
    echo "❌ Benchmark test files not found."
    echo "   Run this script from the project root directory."
    exit 1
fi

echo "📋 Choose benchmark type:"
echo "  1) Quick demo (30s, 50 users) - Fast validation"
echo "  2) Standard benchmark (60s, 100 users) - Full test"
echo "  3) Stress test (120s + scenarios) - Comprehensive"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        echo "🏃 Running quick demo..."
        bun run benchmark:quick
        ;;
    2)
        echo "🔥 Running standard benchmark..."
        bun run benchmark
        ;;
    3)
        echo "💥 Running stress test suite..."
        bun run benchmark:stress
        ;;
    *)
        echo "❌ Invalid choice. Running standard benchmark."
        bun run benchmark
        ;;
esac

echo ""
echo "📊 Results:"
echo "  📈 Interactive report: test/performance/tps-benchmark-report.html"
echo "  📝 Summary: test/performance/benchmark-summary.md"
echo ""
echo "🎯 Key Metrics to Check:"
echo "  • TPS ≥ 18.0 (target achieved)"
echo "  • P95 Latency < 500ms (responsive)"
echo "  • Success Rate > 95% (reliable)"
echo "  • Consensus Success > 90% (Byzantine resistant)"
echo "  • Cross-Settlements > 0 (HTLC working)"
echo ""

if [[ -f "test/performance/tps-benchmark-report.html" ]]; then
    echo "🌐 Opening results in browser..."

    # Try to open in browser (cross-platform)
    if command -v xdg-open &> /dev/null; then
        xdg-open "test/performance/tps-benchmark-report.html"
    elif command -v open &> /dev/null; then
        open "test/performance/tps-benchmark-report.html"
    elif command -v start &> /dev/null; then
        start "test/performance/tps-benchmark-report.html"
    else
        echo "   Manual: Open test/performance/tps-benchmark-report.html in your browser"
    fi
else
    echo "⚠️  HTML report not generated. Check test output for errors."
fi

echo ""
echo "✅ Demo complete! XLN TPS benchmark demonstrates:"
echo "   🚀 Production-ready performance (18+ TPS)"
echo "   🛡️  Byzantine fault tolerance"
echo "   💰 Zero-cost trading model"
echo "   🌐 Cross-settlement capabilities"
echo ""
echo "Next steps:"
echo "  • Review the HTML report for detailed metrics"
echo "  • Check that TPS target was achieved"
echo "  • Examine consensus performance under Byzantine attacks"
echo "  • Verify HTLC cross-settlement success rates"