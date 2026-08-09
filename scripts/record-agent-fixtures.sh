#!/usr/bin/env bash
set -euo pipefail
mkdir -p tests/fixtures/agent
PROMPT='Ответь ровно словом: готово'

echo "== claude =="
claude -p "$PROMPT" --output-format stream-json --verbose \
  > tests/fixtures/agent/claude-stream.jsonl

echo "== codex =="
codex exec --json "$PROMPT" \
  > tests/fixtures/agent/codex-stream.jsonl

wc -l tests/fixtures/agent/*.jsonl
