#!/usr/bin/env bash
# Bake this repo's absolute path into the example MCP configs and workflows.
#
# The example JSON files ship with a "__REPO_ROOT__" placeholder so they stay
# portable in git. The MCP Playground needs absolute paths (for the collector
# MCP's `uv run --directory` and for the filesystem server's allowed root), so
# run this once after cloning - and again if you move the repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Repo root: $ROOT"

shopt -s globstar nullglob
count=0
for f in "$ROOT"/examples/**/*.json; do
  if grep -q "__REPO_ROOT__" "$f" 2>/dev/null; then
    ROOT="$ROOT" perl -pi -e 's|__REPO_ROOT__|$ENV{ROOT}|g' "$f"
    echo "  updated: ${f#"$ROOT"/}"
    count=$((count + 1))
  fi
done

echo "Done. Rewrote $count file(s)."
echo "These are tracked files edited in place; run 'git checkout -- examples' to restore the __REPO_ROOT__ placeholders before committing."
