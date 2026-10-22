#!/bin/sh
# MIT License — Copyright (c) 2026 Rick Gerkin.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export WRANGLER_SEND_METRICS=false
if [ "${1:-}" = "--login" ]; then
  # Open the printed URL manually in the personal rgerkin@gmail.com profile.
  npx --yes wrangler@4.150.0 login --browser=false
elif [ "$#" -ne 0 ]; then
  echo 'Usage: sh scripts/deploy-cloudflare.sh [--login]' >&2
  exit 2
fi
if [ ! -f .env.cloudflare.local ]; then
  echo 'Missing .env.cloudflare.local with SITE_PASSWORD and SESSION_SECRET.' >&2
  exit 1
fi
python3 scripts/prepare-cloudflare.py
npm run test:cloudflare
npx --yes wrangler@4.150.0 deploy --config cloudflare/wrangler.jsonc --secrets-file .env.cloudflare.local
