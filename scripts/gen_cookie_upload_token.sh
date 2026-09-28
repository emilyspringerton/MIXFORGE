#!/usr/bin/env bash
# gen_cookie_upload_token.sh -- mints the bearer token the cookie-exporter extension
# (tools/cookie-exporter) uses to upload youtube.com cookies to IDUNA's
# POST /api/v1/mixforge/cookies. Writes MIXFORGE_COOKIE_UPLOAD_TOKEN into
# var/mixforge-secrets.env (0600, gitignored) and prints it once so you can paste it into the
# extension's options page. IDUNA re-reads this file on every upload, so no restart is needed.
#
# Idempotent: an existing token is kept and printed. Pass --rotate to replace it (the old token
# stops working on the next upload).
set -euo pipefail
cd "$(dirname "$0")/.."

SECRETS="${MIXFORGE_SECRETS_FILE:-var/mixforge-secrets.env}"
mkdir -p "$(dirname "$SECRETS")"
umask 077

existing=""
if [ -f "$SECRETS" ]; then
  existing="$(sed -n 's/^\(export \)\{0,1\}MIXFORGE_COOKIE_UPLOAD_TOKEN=//p' "$SECRETS" | tail -n1 | tr -d "\"'")"
fi

if [ -n "$existing" ] && [ "${1:-}" != "--rotate" ]; then
  token="$existing"
  echo "existing token kept (pass --rotate to replace it)" >&2
else
  token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  tmp="$SECRETS.tmp"
  { [ -f "$SECRETS" ] && grep -v '^\(export \)\{0,1\}MIXFORGE_COOKIE_UPLOAD_TOKEN=' "$SECRETS" || true; } > "$tmp"
  echo "MIXFORGE_COOKIE_UPLOAD_TOKEN=$token" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$SECRETS"
  echo "wrote new token to $SECRETS" >&2
fi
echo "$token"
