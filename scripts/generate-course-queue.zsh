#!/bin/zsh

# Последовательно импортирует и генерирует уроки из полного каталога курса.
#
# Настройки запуска:
#   COURSE_QUEUE_START_PHASE=05
#   COURSE_QUEUE_SKIP_PHASES=06,07
#   COURSE_QUEUE_BASE_URL=http://127.0.0.1:3000
#
# В отличие от старого временного скрипта, источником очереди служит каталог
# курса, а не таблица уже выполненных импортов. Поэтому неимпортированный урок
# не может незаметно выпасть из обхода. После трёх неудачных попыток очередь
# останавливается на текущем уроке: продолжать дальше и оставлять дыру нельзя.

set -u
set -o pipefail

cd "${0:A:h:h}" || exit 1

start_phase="${COURSE_QUEUE_START_PHASE:-01}"
skip_phases=",${COURSE_QUEUE_SKIP_PHASES:-},"
base_url="${COURSE_QUEUE_BASE_URL:-http://127.0.0.1:3000}"
catalog_root=".cache/course-repo/phases"

if [ ! -d "$catalog_root" ]; then
  print -u2 "Каталог курса не найден: $catalog_root"
  exit 1
fi

timestamp() {
  rtk proxy date +%H:%M:%S
}

lesson_complete() {
  local slug="$1"
  local plan_file="content/lessons/$slug/lesson.json"
  local plan actual id

  [ -f "$plan_file" ] || return 1
  plan=$(rtk jq '.steps | length' "$plan_file")
  actual=0
  if [ -d "content/lessons/$slug/steps" ]; then
    actual=$(rtk proxy find "content/lessons/$slug/steps" -type f -name '*.md' \
      | rtk proxy wc -l \
      | rtk proxy tr -d ' ')
  fi
  [ "$plan" -gt 0 ] && [ "$actual" -ge "$plan" ] || return 1

  while IFS= read -r id; do
    # RTK сохраняет пустую строку для пустого jq-результата. Это не id
    # визуализации и не должно превращать готовый урок в незавершённый.
    [ -z "$id" ] && continue
    [ -f "content/lessons/$slug/visuals/$id.html" ] || return 1
  done < <(rtk jq -r '.steps[] | select(.visual_brief != null and .visual_brief != "") | .id' "$plan_file")
  return 0
}

import_lesson() {
  local slug="$1"
  local response

  printf '%s IMPORT %s\n' "$(timestamp)" "$slug"
  if ! response=$(rtk proxy curl -fsS \
    -H 'content-type: application/json' \
    -d "{\"slug\":\"$slug\"}" \
    "$base_url/api/catalog/import"); then
    printf '%s IMPORT_FAILED %s\n' "$(timestamp)" "$slug" >&2
    return 1
  fi
  if ! print -r -- "$response" | rtk jq -e '.error == null' >/dev/null; then
    printf '%s IMPORT_FAILED %s %s\n' "$(timestamp)" "$slug" "$response" >&2
    return 1
  fi
}

generate_lesson() {
  local slug="$1"
  local attempt plan actual

  attempt=1
  while [ "$attempt" -le 3 ]; do
    plan=0
    actual=0
    [ -f "content/lessons/$slug/lesson.json" ] \
      && plan=$(rtk jq '.steps | length' "content/lessons/$slug/lesson.json")
    [ -d "content/lessons/$slug/steps" ] \
      && actual=$(rtk proxy find "content/lessons/$slug/steps" -type f -name '*.md' \
        | rtk proxy wc -l \
        | rtk proxy tr -d ' ')
    printf '%s START %s attempt=%s plan=%s files=%s\n' \
      "$(timestamp)" "$slug" "$attempt" "$plan" "$actual"

    if rtk proxy curl -sS --no-buffer --connect-timeout 5 -X POST \
      "$base_url/api/lesson/$slug/generate?from=0&all=1" \
      | rtk proxy awk -v slug="$slug" '
          /^event: / { event=$2 }
          /^data: / {
            if (event == "progress" || event == "error" || event == "done") {
              print slug, event, substr($0, 7)
              fflush()
            }
            if (event == "done") finished=1
          }
          END { exit(finished ? 0 : 1) }
        '
    then
      if lesson_complete "$slug"; then
        printf '%s DONE %s\n' "$(timestamp)" "$slug"
        return 0
      fi
    fi

    attempt=$((attempt + 1))
    [ "$attempt" -le 3 ] && rtk proxy sleep 10
  done

  printf '%s STOPPED_AT %s after=3\n' "$(timestamp)" "$slug" >&2
  return 1
}

while IFS= read -r docs_dir; do
  lesson_dir="${docs_dir:h:t}"
  phase_dir="${docs_dir:h:h:t}"
  phase_number="${phase_dir%%-*}"
  slug="${phase_dir}__${lesson_dir}"

  [[ "$phase_number" < "$start_phase" ]] && continue
  if [[ "$skip_phases" == *",${phase_number},"* ]]; then
    printf '%s SKIP_EXTERNAL_PHASE %s\n' "$(timestamp)" "$slug"
    continue
  fi

  if [ ! -d "source/phases/$phase_dir/$lesson_dir/docs" ]; then
    import_lesson "$slug" || exit 1
  fi

  lesson_complete "$slug" && continue
  generate_lesson "$slug" || exit 1
done < <(rtk proxy find "$catalog_root" -mindepth 3 -maxdepth 3 -type d -name docs | rtk proxy sort)

printf '%s QUEUE_COMPLETE\n' "$(timestamp)"
