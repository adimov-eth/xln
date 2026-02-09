#!/bin/bash
# Auto-deploy script - run after every git push
# IMPORTANT: Run `npm run test:landing` locally BEFORE pushing

set -e  # Exit on any error

ssh -i ~/.ssh/xln_deploy root@xln.finance << 'ENDSSH'
cd /root/xln
git pull origin main

# Add bun to PATH
export PATH="$HOME/.bun/bin:$PATH"
./deploy.sh --skip-pull

echo "✅ Deployed at $(date)"
echo "✅ Server status:"
pm2 status | sed -n '1,40p'
ENDSSH
