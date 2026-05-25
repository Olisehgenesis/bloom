#!/usr/bin/env bash
# Push all variables from .env (dotenvx-encrypted) to Vercel for the chosen env.
#
# Usage:
#   ./scripts/push-env-to-vercel.sh                  # defaults to: production
#   ./scripts/push-env-to-vercel.sh preview
#   ./scripts/push-env-to-vercel.sh production preview development
#
# Requires: vercel CLI logged in & `vercel link`'d in this project,
#           @dotenvx/dotenvx installed (pnpm i already does this).

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

# Default targets if none passed
if [ "$#" -eq 0 ]; then
  TARGETS=(production)
else
  TARGETS=("$@")
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found in $(pwd)"
  exit 1
fi

# Extract key names: lines starting with A-Z/_/digit followed by '=', no leading '#'.
KEYS=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed -E 's/=.*$//' | sort -u)

if [ -z "$KEYS" ]; then
  echo "✗ no keys found in $ENV_FILE"
  exit 1
fi

# Keys we never want to push to Vercel.
SKIP_KEYS=(DOTENV_PUBLIC_KEY DOTENV_PRIVATE_KEY)

is_skipped() {
  local k="$1"
  for s in "${SKIP_KEYS[@]}"; do
    if [ "$k" = "$s" ]; then return 0; fi
  done
  return 1
}

for TARGET in "${TARGETS[@]}"; do
  echo ""
  echo "━━━ Target: $TARGET ━━━"

  for KEY in $KEYS; do
    if is_skipped "$KEY"; then
      echo "↷ skip $KEY"
      continue
    fi

    # Read plaintext value from .env (handles quoted and unquoted values).
    VALUE="$(grep -E "^${KEY}=" "$ENV_FILE" | head -n1 | sed -E "s/^${KEY}=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'$/\1/")"

    if [ -z "$VALUE" ]; then
      echo "↷ skip $KEY (empty)"
      continue
    fi

    # Remove existing var (ignore errors), then add fresh.
    vercel env rm "$KEY" "$TARGET" --yes >/dev/null 2>&1 || true

    if printf '%s' "$VALUE" | vercel env add "$KEY" "$TARGET" >/dev/null 2>&1; then
      echo "✓ $KEY → $TARGET"
    else
      echo "✗ $KEY → $TARGET (failed)"
    fi
  done
done

echo ""
echo "Done. Trigger a redeploy: vercel --prod"
