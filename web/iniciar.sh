#!/bin/bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node/npm. Instálalo una sola vez con: brew install node"
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- dev
fi

# Use the standard Node-based CLI. The standalone native executable cannot
# execute local TypeScript functions reliably and treats them as single-file deployments.
exec npx --yes vercel@58.9.0 "$@"
