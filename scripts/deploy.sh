#!/usr/bin/env bash
# Deploy the committed HEAD of this repo to the Aura VPS.
#   ./scripts/deploy.sh            (uses the "aura-vps" SSH alias)
#   DEPLOY_HOST=user@host ./scripts/deploy.sh
#
# Ships only committed files (git archive), so local .env files and the server's
# secrets (/opt/farmos/.env, backend/.env.production) are never overwritten.
set -euo pipefail

HOST="${DEPLOY_HOST:-aura-vps}"
DIR=/opt/farmos
REV=$(git rev-parse --short HEAD)

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes: commit first (only committed code is deployed)." >&2
  exit 1
fi

echo "==> Uploading $REV to $HOST:$DIR"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C $DIR && echo $REV > $DIR/REVISION"

echo "==> Building and restarting (other sites on the server are not touched)"
ssh "$HOST" "cd $DIR && docker compose build </dev/null && docker compose up -d </dev/null \
  && docker compose exec -T api php artisan migrate --force </dev/null \
  && docker compose ps --format '{{.Service}}: {{.Status}}' </dev/null"

echo "==> Checking https://auradairy.com"
ssh "$HOST" "curl -s -o /dev/null -w 'site %{http_code}\n' https://auradairy.com/ && curl -s -o /dev/null -w 'api  %{http_code}\n' https://auradairy.com/api/public/farms/1"
echo "Deployed $REV"
