#!/bin/bash

# Pure Bun Deployment to Vultr
# Usage: ./deploy-bun.sh [SERVER_IP]

set -e

SERVER_IP="${1:-136.244.85.89}"
SERVER_USER="root"
XLN_DIR="/root/xln"

echo "[LAUNCH] Pure Bun Deployment to Vultr"
echo "==============================="
echo "Server: $SERVER_IP"
echo ""

# Test connection
echo "[FIND] Testing server connection..."
if ! ssh -o ConnectTimeout=5 $SERVER_USER@$SERVER_IP exit 2>/dev/null; then
    echo "[X] Cannot connect to $SERVER_IP"
    exit 1
fi
echo "[OK] Connected to server"

# Upload and run pure Bun setup
echo "[PKG] Setting up pure Bun environment..."
scp setup-server-bun.sh $SERVER_USER@$SERVER_IP:/tmp/
ssh $SERVER_USER@$SERVER_IP "chmod +x /tmp/setup-server-bun.sh && /tmp/setup-server-bun.sh"

# Clone or update repository
echo "[FOLDER] Setting up XLN repository..."
ssh $SERVER_USER@$SERVER_IP "
    if [ ! -d $XLN_DIR/.git ]; then
        echo 'Cloning XLN repository...'
        rm -rf $XLN_DIR
        git clone https://github.com/xlnfinance/xln.git $XLN_DIR
    else
        echo 'Repository exists, pulling latest...'
        cd $XLN_DIR && git pull origin main
    fi
"

# Deploy XLN
echo "[LAUNCH] Deploying XLN..."
ssh $SERVER_USER@$SERVER_IP "cd $XLN_DIR && ./deploy.sh"

# Check status
echo "[STATS] Checking deployment status..."
ssh $SERVER_USER@$SERVER_IP "sudo systemctl status xln --no-pager -l"

echo ""
echo "[DONE] Pure Bun Deployment Complete!"
echo "================================"
echo "[WEB] XLN is running at: http://$SERVER_IP"
echo ""
echo "[TOOL] Management commands:"
echo "   • Status: ssh $SERVER_USER@$SERVER_IP 'sudo systemctl status xln'"
echo "   • Logs: ssh $SERVER_USER@$SERVER_IP 'journalctl -u xln -f'"
echo "   • Restart: ssh $SERVER_USER@$SERVER_IP 'sudo systemctl restart xln'"
echo ""
echo "[OK] Deployment successful! [LAUNCH]"
