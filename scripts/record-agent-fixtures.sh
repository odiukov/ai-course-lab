#!/usr/bin/env bash
# Перезаписывает фикстуры стрима обоих CLI.
# Флаги берутся прямо из адаптеров (scripts/print-agent-args.mts), поэтому
# запись не может разойтись с тем, чем приложение запускает агента.
# Совместимо с bash 3.2 (системный bash в macOS): без mapfile и nameref.
set -euo pipefail
mkdir -p tests/fixtures/agent
PROMPT='Ответь ровно словом: готово'

echo "== claude =="
CLAUDE_ARGS=()
while IFS= read -r line; do CLAUDE_ARGS+=("$line"); done \
  < <(npx tsx scripts/print-agent-args.mts claude "$PROMPT")
printf '   claude'; printf ' %q' "${CLAUDE_ARGS[@]}"; printf '\n'
claude "${CLAUDE_ARGS[@]}" > tests/fixtures/agent/claude-stream.jsonl

echo "== codex =="
CODEX_ARGS=()
while IFS= read -r line; do CODEX_ARGS+=("$line"); done \
  < <(npx tsx scripts/print-agent-args.mts codex "$PROMPT")
printf '   codex'; printf ' %q' "${CODEX_ARGS[@]}"; printf '\n'
codex "${CODEX_ARGS[@]}" > tests/fixtures/agent/codex-stream.jsonl

wc -l tests/fixtures/agent/*.jsonl
