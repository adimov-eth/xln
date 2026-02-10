#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# deploy-testnet.sh — Deploy xln to testnet VPS
# Runs from LOCAL machine. Syncs code, installs deps, creates .env, restarts.
#
# Prerequisites:
#   1. setup-testnet.sh already ran on the VPS
#   2. DNS for x.bkk.lol points to 139.60.161.132
#
# Usage:
#   ./scripts/deployment/deploy-testnet.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

VPS_HOST="139.60.161.132"
VPS_USER="root"
VPS_DIR="/root/xln"
DOMAIN="x.bkk.lol"

# Read deployer key from local .env
DEPLOYER_KEY=""
if [ -f .env ]; then
  DEPLOYER_KEY=$(grep '^DEPLOYER_PRIVATE_KEY=' .env | cut -d= -f2)
fi
if [ -z "$DEPLOYER_KEY" ]; then
  echo "ERROR: DEPLOYER_PRIVATE_KEY not found in .env"
  exit 1
fi

echo "═══════════════════════════════════════"
echo "  Deploying xln to $DOMAIN"
echo "  VPS: $VPS_USER@$VPS_HOST"
echo "═══════════════════════════════════════"

# ── 1. Sync code ─────────────────────────────────────────────────────────────
echo "[1/4] Syncing code to VPS..."
rsync -azP --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude db-tmp \
  --exclude '*.db' \
  --exclude jurisdictions/node_modules \
  --exclude jurisdictions/artifacts \
  --exclude jurisdictions/cache \
  --exclude .env \
  ./ "$VPS_USER@$VPS_HOST:$VPS_DIR/"

echo "  Code synced"

# ── 2. Create .env on VPS ────────────────────────────────────────────────────
echo "[2/4] Writing .env on VPS..."
ssh "$VPS_USER@$VPS_HOST" "cat > $VPS_DIR/.env" << ENV_EOF
DEPLOYER_PRIVATE_KEY=$DEPLOYER_KEY
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PUBLIC_HTTP=https://$DOMAIN
PUBLIC_RPC=https://$DOMAIN/rpc
RELAY_URL=wss://$DOMAIN/relay
HUB_SEED=xln-testnet-hub-seed-v1
ENV_EOF
echo "  .env written"

# ── 3. Install deps ──────────────────────────────────────────────────────────
echo "[3/4] Installing dependencies on VPS..."
ssh "$VPS_USER@$VPS_HOST" << 'REMOTE_EOF'
set -euo pipefail
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

cd /root/xln

# Install runtime dependencies
bun install --frozen-lockfile 2>/dev/null || bun install
REMOTE_EOF
echo "  Dependencies installed"

# ── 4. Restart via systemd ───────────────────────────────────────────────────
echo "[4/4] Restarting xln via systemd..."
ssh "$VPS_USER@$VPS_HOST" << 'REMOTE_EOF'
set -euo pipefail

# Reload unit file in case it changed, then restart
systemctl daemon-reload
systemctl restart xln

echo "Waiting for server to start..."
sleep 10

echo ""
echo "Service status:"
systemctl is-active xln

# Health check
echo ""
echo "Health check:"
curl -sf http://127.0.0.1:8080/api/health && echo " OK" || echo " PENDING (server still starting — on-chain funding takes ~5min)"
REMOTE_EOF

echo ""
echo "═══════════════════════════════════════"
echo "  Deployment complete!"
echo "  https://$DOMAIN/api/health"
echo "═══════════════════════════════════════"
