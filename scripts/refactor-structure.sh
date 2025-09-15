#!/bin/bash
# XLN Repository Structure Refactoring
# With OCD precision - organizing the chaos

set -e

echo "🏗️ Refactoring XLN repository structure..."

# Create proper directory structure
echo "📁 Creating clean directory structure..."
mkdir -p scripts/{debug,tools,bench,deploy}
mkdir -p examples/{demos,visualization,legacy}
mkdir -p docs/{protocol,assets,deployment}
mkdir -p archive/{old_src,old_docs}
mkdir -p src/legacy

# Move debug scripts
echo "🐛 Organizing debug scripts..."
mv debug.js scripts/debug/ 2>/dev/null || true
mv debug-simple.js scripts/debug/ 2>/dev/null || true
mv debug-reserves.js scripts/debug/ 2>/dev/null || true
mv debug-repl.js scripts/debug/ 2>/dev/null || true

# Move tool scripts
echo "🔧 Organizing tools..."
mv gpt.js scripts/tools/ 2>/dev/null || true
mv enc.js scripts/bench/ 2>/dev/null || true

# Move demos
echo "🎮 Organizing demos..."
mv bilateral-p2p.ts examples/demos/ 2>/dev/null || true
mv bilateral-reality-demo.ts examples/demos/ 2>/dev/null || true
mv trade-credit-demo.ts examples/demos/ 2>/dev/null || true
mv test-fee-curves.ts examples/demos/ 2>/dev/null || true

# Move visualization
echo "📊 Organizing visualization..."
mv visualization.js examples/visualization/ 2>/dev/null || true
mv hubspokes.html examples/visualization/ 2>/dev/null || true
mv legacy.html examples/legacy/ 2>/dev/null || true

# Move deployment scripts
echo "🚀 Organizing deployment scripts..."
mv deploy-*.sh scripts/deploy/ 2>/dev/null || true
mv setup-*.sh scripts/deploy/ 2>/dev/null || true
mv start-networks.sh scripts/deploy/ 2>/dev/null || true
mv stop-networks.sh scripts/deploy/ 2>/dev/null || true
mv reset-networks.sh scripts/deploy/ 2>/dev/null || true

# Move documentation
echo "📚 Organizing documentation..."
mv DEPLOYMENT_LESSONS.md docs/deployment/ 2>/dev/null || true
mv CONTRACT_DEPLOYMENT.md docs/deployment/ 2>/dev/null || true
mv PRODUCTION_REALITY.md docs/deployment/ 2>/dev/null || true
mv VULTR_DEPLOYMENT.md docs/deployment/ 2>/dev/null || true
mv IMPLEMENTATION_MEMO.md docs/ 2>/dev/null || true
mv PRE_RELEASE_CHECKLIST.md docs/ 2>/dev/null || true
mv MIGRATE_TO_SVELTE.md docs/ 2>/dev/null || true

# Move screenshots to assets
echo "🖼️ Moving screenshots to assets..."
mv *.png docs/assets/ 2>/dev/null || true

# Archive old_src and old_docs but keep accessible
echo "📦 Archiving legacy code (but keeping it accessible)..."
if [ -d "old_src" ]; then
    echo "  Moving old_src to archive/old_src..."
    mv old_src archive/
fi
if [ -d "old_docs" ]; then
    echo "  Moving old_docs to archive/old_docs..."
    mv old_docs archive/
fi

# Create symlinks for backward compatibility (important!)
echo "🔗 Creating compatibility symlinks..."
ln -sf archive/old_src old_src 2>/dev/null || true
ln -sf archive/old_docs old_docs 2>/dev/null || true

# Clean up dev scripts - consolidate them
echo "🧹 Consolidating dev scripts..."
cat > scripts/dev.sh << 'EOF'
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
EOF

chmod +x scripts/dev.sh
rm -f dev*.sh 2>/dev/null || true

# Create proper project manifest
echo "📋 Creating project manifest..."
cat > PROJECT_STRUCTURE.md << 'EOF'
# XLN Project Structure

## Core Directories

```
xln/
├── src/                    # Main source code
│   ├── bridges/           # Bridge implementations
│   ├── consensus/         # BFT consensus layer
│   ├── entities/          # Entity management
│   ├── merkle/           # Merkle tree implementations
│   ├── organizations/    # Organizational primitives
│   └── legacy/           # Integration with old_src
│
├── archive/               # Preserved legacy code
│   ├── old_src/          # Original working channel implementation
│   └── old_docs/         # Original protocol documentation
│
├── contracts/            # Smart contracts
├── frontend/            # Web interface
├── cli/                # Command-line interface
│
├── examples/            # Demos and examples
│   ├── demos/          # Working demonstrations
│   ├── visualization/  # Visual tools
│   └── legacy/        # Historical examples
│
├── scripts/            # Utility scripts
│   ├── debug/         # Debugging tools
│   ├── tools/         # Development tools
│   ├── bench/         # Benchmarks
│   └── deploy/        # Deployment scripts
│
├── docs/              # Documentation
│   ├── protocol/      # Protocol specs
│   ├── deployment/    # Deployment guides
│   └── assets/        # Images and diagrams
│
├── test/              # Test suites
├── e2e/               # End-to-end tests
└── benchmarks/        # Performance benchmarks
```

## Key Files

- `src/server.ts` - Main server entry point
- `archive/old_src/app/Channel.ts` - Working bilateral channel implementation
- `archive/old_src/app/Transition.ts` - State transition logic
- `examples/demos/trade-credit-demo.ts` - Trade credit demonstration

## Symlinks for Compatibility

- `old_src` -> `archive/old_src`
- `old_docs` -> `archive/old_docs`

These symlinks ensure existing code continues to work while we migrate.
EOF

# Update package.json scripts
echo "📦 Updating package.json scripts..."
cat > update-package-scripts.js << 'EOF'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Update scripts to use new paths
if (pkg.scripts) {
    Object.keys(pkg.scripts).forEach(key => {
        pkg.scripts[key] = pkg.scripts[key]
            .replace('bilateral-p2p.ts', 'examples/demos/bilateral-p2p.ts')
            .replace('bilateral-reality-demo.ts', 'examples/demos/bilateral-reality-demo.ts')
            .replace('trade-credit-demo.ts', 'examples/demos/trade-credit-demo.ts')
            .replace('test-fee-curves.ts', 'examples/demos/test-fee-curves.ts');
    });
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('✅ Updated package.json scripts');
EOF

node update-package-scripts.js
rm update-package-scripts.js

# Create README for archive
cat > archive/README.md << 'EOF'
# Archive Directory

This directory contains the original XLN implementation that has been preserved for reference and integration.

## old_src/

Contains the **working bilateral channel implementation** with:
- Real RLP encoding
- State transitions
- deriveDelta function with three-zone capacity model
- LevelDB persistence

This code is actively used via symlinks and should NOT be deleted.

## old_docs/

Contains the original protocol documentation including:
- Channel design
- Consensus mechanism
- Four balances model
- Threat analysis

These documents are the authoritative source for XLN protocol design.

## Integration Status

The code in `old_src` is being integrated with the new architecture in `src/` via:
- `src/RealEntityChannelBridge.ts` - Bridges old and new implementations
- `src/legacy/` - Adapter layers for old_src components

## Important

DO NOT DELETE OR MODIFY without understanding the dependencies.
These are not deprecated - they are the foundation.
EOF

echo "✅ Refactoring complete!"
echo ""
echo "📊 New structure:"
echo "  - Debug scripts: scripts/debug/"
echo "  - Tools: scripts/tools/"
echo "  - Demos: examples/demos/"
echo "  - Legacy code: archive/ (with symlinks preserved)"
echo "  - Documentation: docs/"
echo ""
echo "🔗 Symlinks created for backward compatibility:"
echo "  - old_src -> archive/old_src"
echo "  - old_docs -> archive/old_docs"
echo ""
echo "Next steps:"
echo "1. Review PROJECT_STRUCTURE.md for the new layout"
echo "2. Test that demos still work with: bun run examples/demos/trade-credit-demo.ts"
echo "3. Verify symlinks work: ls -la old_src/"