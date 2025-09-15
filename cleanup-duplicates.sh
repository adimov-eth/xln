#!/bin/bash
# Remove theatrical duplicate implementations
# Keep only what's real and actually used

set -e

echo "🧹 Starting aggressive cleanup of theatrical code..."

# 1. Remove duplicate EntityChannelBridge implementations
echo "🗑️ Removing theatrical EntityChannelBridge duplicates..."
if [ -f "src/EntityChannelBridge.ts" ]; then
  echo "  Removing EntityChannelBridge.ts (theatrical, unused)"
  rm src/EntityChannelBridge.ts
fi

if [ -f "src/EntityChannelBridgeEnhanced.ts" ]; then
  echo "  Removing EntityChannelBridgeEnhanced.ts (even more theatrical)"
  rm src/EntityChannelBridgeEnhanced.ts
fi

echo "  ✅ Keeping RealEntityChannelBridge.ts (actually imports Channel.ts)"

# 2. Check for unused database adapters
echo "🗑️ Checking database adapters..."
if [ -d "src/database" ]; then
  for file in src/database/*.ts; do
    if [ -f "$file" ]; then
      basename=$(basename "$file")
      # Check if it's imported anywhere
      if ! grep -r "$basename" src/ --exclude-dir=database > /dev/null 2>&1; then
        echo "  Removing unused: $basename"
        rm "$file"
      fi
    fi
  done
fi

# 3. Remove empty directories
echo "🗑️ Removing empty directories..."
if [ -d "src/bridges" ]; then
  if [ -z "$(ls -A src/bridges)" ]; then
    echo "  Removing empty src/bridges/"
    rmdir src/bridges
  fi
fi

# 4. Check transformer usage
echo "🔍 Checking transformer usage..."
UNUSED_TRANSFORMERS=""
for file in src/transformers/*.ts; do
  if [ -f "$file" ]; then
    basename=$(basename "$file" .ts)
    # Skip index and base files
    if [[ "$basename" != "index" && "$basename" != "BaseTransformer" && "$basename" != "BaseTransformerOptimized" ]]; then
      # Check if it's imported outside transformers directory
      if ! grep -r "import.*$basename" src/ test/ --exclude-dir=transformers > /dev/null 2>&1; then
        if ! grep -r "$basename" src/ test/ --exclude-dir=transformers > /dev/null 2>&1; then
          UNUSED_TRANSFORMERS="$UNUSED_TRANSFORMERS $file"
        fi
      fi
    fi
  fi
done

if [ -n "$UNUSED_TRANSFORMERS" ]; then
  echo "  Found unused transformers:"
  for file in $UNUSED_TRANSFORMERS; do
    echo "    - $(basename $file)"
  done
fi

# 5. Check for theatrical organizational code
echo "🔍 Checking organizational code usage..."
if [ -d "src/organizations" ]; then
  ORG_USED=$(grep -r "from.*organizations" src/ test/ examples/ 2>/dev/null | wc -l)
  if [ "$ORG_USED" -eq 0 ]; then
    echo "  ⚠️ Organizations directory appears unused"
  else
    echo "  ✅ Organizations code is used ($ORG_USED imports found)"
  fi
fi

# 6. Find files with only stub implementations
echo "🔍 Finding stub implementations..."
STUB_FILES=$(grep -l "throw new Error.*not implemented\|Method not implemented\|TODO.*implement" src/**/*.ts 2>/dev/null || true)
if [ -n "$STUB_FILES" ]; then
  echo "  Files with stub implementations:"
  for file in $STUB_FILES; do
    echo "    - $file"
  done
fi

# 7. Summary
echo ""
echo "📊 Cleanup Summary:"
echo "  - Removed theatrical EntityChannelBridge duplicates"
echo "  - Identified unused transformers"
echo "  - Found stub implementations"
echo ""
echo "💡 Recommendations:"
echo "  1. RealEntityChannelBridge.ts is the only real bridge (imports Channel.ts)"
echo "  2. Consider removing unused transformers"
echo "  3. Either implement stubs or remove them"
echo "  4. Organizations code appears to be used in tests"

# 8. Optional aggressive cleanup (commented out for safety)
echo ""
echo "🚨 For aggressive cleanup, uncomment and run:"
echo "  # Remove all unused transformers"
echo "  # for file in $UNUSED_TRANSFORMERS; do rm \$file; done"
echo ""
echo "  # Remove stub implementations"
echo "  # for file in $STUB_FILES; do rm \$file; done"