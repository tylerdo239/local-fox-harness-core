#!/usr/bin/env bash
# Regenerates ../node-catalog.json.gz — the n8n node schema knowledge base
# n8n_describe_node reads from. Run this again whenever the target n8n
# instance's version changes (new/changed nodes, new typeVersions); the file
# is a point-in-time extraction, not something the agent refreshes itself.
#
# Needs a RUNNING n8n container (any n8n instance is fine — the catalog is
# generic n8n knowledge, not tied to this deployment's own workflows/data).
# Usage: ./regenerate-catalog.sh [container-name]  (default: cordis-n8n)
set -euo pipefail

CONTAINER="${1:-cordis-n8n}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_FILE="$SCRIPT_DIR/../node-catalog.json.gz"

docker cp "$SCRIPT_DIR/extract-node-catalog.cjs" "$CONTAINER:/tmp/extract-node-catalog.cjs"
docker exec "$CONTAINER" node /tmp/extract-node-catalog.cjs > /tmp/node-catalog.$$.json
gzip -9 -c /tmp/node-catalog.$$.json > "$OUT_FILE"
rm -f /tmp/node-catalog.$$.json
docker exec "$CONTAINER" rm -f /tmp/extract-node-catalog.cjs || true

echo "wrote $OUT_FILE ($(wc -c < "$OUT_FILE") bytes)"
