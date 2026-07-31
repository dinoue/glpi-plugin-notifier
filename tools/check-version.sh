#!/usr/bin/env bash
#
# The version lives in three places that must agree, and a mismatch only
# shows up as a confusing "plugin needs updating" prompt in GLPI.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

setup_version=$(sed -n "s/^define('PLUGIN_NOTIFIER_VERSION', '\([^']*\)').*/\1/p" setup.php)
xml_version=$(sed -n 's:.*<num>\(.*\)</num>.*:\1:p' notifier.xml | head -1)
changelog_version=$(sed -n 's/^## \[\([0-9][^]]*\)\].*/\1/p' CHANGELOG.md | head -1)

echo "setup.php:    $setup_version"
echo "notifier.xml: $xml_version"
echo "CHANGELOG.md: $changelog_version"

if [[ -z "$setup_version" ]]; then
    echo "could not read the version from setup.php" >&2
    exit 1
fi

if [[ "$setup_version" != "$xml_version" || "$setup_version" != "$changelog_version" ]]; then
    echo "version mismatch across setup.php, notifier.xml and CHANGELOG.md" >&2
    exit 1
fi

echo "versions agree: $setup_version"
