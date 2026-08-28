#!/bin/sh
# Build and deploy the Mealy web app to app.rawdev.link.
set -e
cd "$(dirname "$0")"
cd ../../app
rm -rf dist
EXPO_PUBLIC_WORKER_URL=https://mealy-worker.fly.dev npx expo export --platform web
node ../workers/mealy-app/inject-head.mjs dist/index.html
cd ../workers/mealy-app
npx wrangler deploy
