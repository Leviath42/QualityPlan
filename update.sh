#!/usr/bin/env bash
# update.sh — déploiement QualityPlan sur le CT (standard modop).
# Usage (depuis le CT, dans /opt/qualityplan) : bash update.sh
# Ne redémarre le service QUE si les tests passent (gate locale).
set -euo pipefail
cd /opt/qualityplan

echo "[1/5] git pull"
git pull --ff-only

echo "[2/5] npm ci"
npm ci

echo "[3/5] build (server + web)"
npm run build

echo "[4/5] tests (gate locale)"
npm test

echo "[5/5] restart pm2 + healthcheck"
pm2 restart qualityplan || pm2 start server/ecosystem.config.cjs
pm2 save
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3100/api/health > /dev/null; then
    echo "OK : health 200"
    exit 0
  fi
  sleep 2
done
echo "ECHEC : /api/health injoignable après restart" >&2
exit 1
