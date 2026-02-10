#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# setup-testnet.sh — One-time setup for a fresh VPS
# Target: x.bkk.lol (139.60.161.132), Ubuntu/Debian, root
#
# Installs: Bun, Nginx, Certbot (Let's Encrypt SSL)
# Creates:  /root/xln directory, systemd xln.service unit
#
# Usage (from local machine):
#   ssh root@139.60.161.132 'bash -s' < scripts/deployment/setup-testnet.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="x.bkk.lol"
APP_DIR="/root/xln"
PORT=8080

echo "═══════════════════════════════════════"
echo "  xln testnet VPS setup"
echo "  Domain: $DOMAIN"
echo "═══════════════════════════════════════"

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/6] Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl unzip nginx certbot python3-certbot-nginx build-essential

# ── 2. Install Bun ────────────────────────────────────────────────────────────
echo "[2/6] Installing Bun..."
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # Persist in .bashrc
  grep -q 'BUN_INSTALL' ~/.bashrc || {
    echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
  }
else
  echo "  Bun already installed: $(bun --version)"
fi

# Ensure bun is on PATH for rest of script
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "  Bun version: $(bun --version)"

# ── 3. Create systemd service ─────────────────────────────────────────────────
echo "[3/6] Creating systemd service..."
cat > /etc/systemd/system/xln.service << 'UNIT_EOF'
[Unit]
Description=xln consensus server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/xln
Environment=PATH=/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=/root/xln/.env
ExecStart=/root/.bun/bin/bun runtime/server.ts --port 8080
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable xln
echo "  systemd unit created and enabled"

# ── 4. Create app directory ──────────────────────────────────────────────────
echo "[4/6] Preparing app directory..."
mkdir -p "$APP_DIR"

# ── 5. Nginx config ──────────────────────────────────────────────────────────
echo "[5/6] Configuring Nginx..."
cat > /etc/nginx/sites-available/xln << 'NGINX_EOF'
server {
    listen 80;
    server_name x.bkk.lol;

    # API + WebSocket proxy
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-lived WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
NGINX_EOF

# Enable site, remove default
ln -sf /etc/nginx/sites-available/xln /etc/nginx/sites-enabled/xln
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx
echo "  Nginx configured and restarted"

# ── 6. SSL (Let's Encrypt) ──────────────────────────────────────────────────
echo "[6/6] Obtaining SSL certificate..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@xln.finance --redirect || {
  echo "  SSL setup failed (DNS might not point here yet). Run manually later:"
  echo "  certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@xln.finance --redirect"
}

echo ""
echo "═══════════════════════════════════════"
echo "  Setup complete!"
echo "  Next: run deploy-testnet.sh"
echo "═══════════════════════════════════════"
