#!/usr/bin/env bash
# 垫付/报销数据层逻辑测试（Node + fake-indexeddb）
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=node_modules/.tmp
mkdir -p "$TMP"
printf "import 'fake-indexeddb/auto';\n" > "$TMP/test-shim.mjs"
printf "export default { toDataURL: async () => '' };\n" > "$TMP/qrcode-stub.mjs"

npx esbuild scripts/test-expenses.ts \
  --bundle --platform=node --format=esm \
  --outfile="$TMP/test-expenses.mjs" \
  --inject:"$TMP/test-shim.mjs" \
  --alias:qrcode="$PWD/$TMP/qrcode-stub.mjs" \
  >/dev/null

node "$TMP/test-expenses.mjs"
