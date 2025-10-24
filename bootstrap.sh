#!/bin/bash
# One-liner installer for XLN
set -e

echo "[LAUNCH] Installing XLN..."
echo ""

# Clone repo to xln directory
if [ -d "xln" ]; then
    echo "[WARN]  Directory 'xln' already exists"
    read -p "Delete and reinstall? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf xln
    else
        echo "[X] Installation cancelled"
        exit 1
    fi
fi

git clone https://github.com/xlnfinance/xln.git xln
cd xln

echo ""
echo "[OK] Cloned to ./xln"
echo "[LAUNCH] Starting development environment..."
echo ""

# Run dev (which auto-installs everything)
./dev-full.sh
