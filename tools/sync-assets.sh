#!/usr/bin/env bash
#
# GLPI 11 serves plugin assets from public/, GLPI 10 from css/ and js/.
# css/ and js/ are the sources; public/ is generated. Run this after
# touching either, or run with --check to verify they match (CI does).
#
# This exists because the two copies silently drifted in v1.0.2 and
# again in v1.0.3, both times shipping a broken bell to GLPI 11 only.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

pairs=(
    "css/notifier.css:public/notifier.css"
    "js/notifier.js:public/notifier.js"
)

mode="sync"
if [[ "${1:-}" == "--check" ]]; then
    mode="check"
fi

status=0

for pair in "${pairs[@]}"; do
    src="${pair%%:*}"
    dst="${pair##*:}"

    if [[ ! -f "$src" ]]; then
        echo "missing source: $src" >&2
        status=1
        continue
    fi

    if [[ "$mode" == "check" ]]; then
        if ! diff -q "$src" "$dst" >/dev/null 2>&1; then
            echo "DRIFT: $dst does not match $src" >&2
            diff -u "$src" "$dst" || true
            status=1
        else
            echo "ok: $dst matches $src"
        fi
    else
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        echo "synced: $src -> $dst"
    fi
done

exit $status
