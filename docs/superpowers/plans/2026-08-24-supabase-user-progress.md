# Юзеры и облачный прогресс статического сайта — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать опубликованному на GitHub Pages сайту курса аккаунты через GitHub OAuth и облачный прогресс в Supabase, влив при первом входе тот прогресс, который уже накоплен в браузере.

**Architecture:** Local-first. `localStorage` остаётся рабочим хранилищем страницы, облако — зеркало. Вся спорная логика (слияние, миграция) вынесена в чистые модули `src/lib/sync/*` с юнит-тестами; сетевой слой живёт в отдельном бандле `out/assets/auth.js`, который собирается esbuild-ом тем же способом, что уже собирается редактор, и общается со страницей через `window.CourseSync` и события DOM.

**Tech Stack:** TypeScript, vitest + happy-dom, esbuild, `@supabase/supabase-js` v2, Supabase (Postgres + GoTrue + RLS), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-24-supabase-user-progress-design.md`

## Global Constraints

- Синхронизация касается **только** статического сайта из `out/`. Локальное приложение Next.js и `data/progress.db` не трогаются ни одной строкой.
- Порядок записи всегда «сначала `localStorage`, потом сеть». Отметка «прочитан» обязана успеть до навигации, а синхронна только запись на диск браузера.
- Любое обращение к `localStorage` обёрнуто в `try` — в приватном окне Safari запись бросает, и без обёртки падает весь скрипт страницы.
- Отсутствие `SUPABASE_URL`/`SUPABASE_ANON_KEY` в окружении не ломает сборку: без них `assets/auth.js` не собирается и не подключается, сайт получается такой же, как сегодня.
- Формат ключа `course-progress:<lesson-slug>` (массив id прочитанных шагов) не меняется: он уже лежит в браузерах читателей.
- Точные значения ключей `localStorage`: `course-progress:`, `course-step-state:`, `course-exercise:`, `course-synced:`, суффиксы `:updatedAt`, `:recovery`, `:local-backup`.
- Состояния шага: строки `read`, `failed`, `passed`. Ранги при слиянии: `read` = 1, `failed` = 1, `passed` = 2.
- Клиентский JS страниц — ES5-совместимый (`var`, `function`), как весь существующий код в `src/lib/site/client.ts`. Бандлы (`editor.js`, `auth.js`) — обычный TypeScript.
- Комментарии в коде — по-русски, как во всём репозитории. Сообщения коммитов — по-английски, conventional commits (`feat(site): …`).
- Проверка после каждой задачи: `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 1: Проект Supabase, схема и защита строк

**Files:**
- Create: `supabase/schema.sql`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: ничего.
- Produces: две переменные окружения `SUPABASE_URL` и `SUPABASE_ANON_KEY`; три таблицы `step_progress`, `exercise_files`, `run_results` с колонками, перечисленными в шаге 1.

Задача ручная: консоль Supabase, GitHub OAuth и проверка политик. Задачи 2–5 от неё не зависят и могут идти параллельно — сеть в них не участвует.

- [ ] **Step 1: Написать файл схемы**

Create `supabase/schema.sql`:

```sql
-- Схема облачного прогресса статического сайта.
--
-- Накатывается руками через SQL Editor в консоли Supabase. Механизма миграций
-- нет намеренно: таблиц три, проект один, а CLI Supabase потребовал бы
-- связанного локального Postgres ради трёх create table.
--
-- Анонимный ключ лежит открытым текстом в HTML — так устроен Supabase, ключ
-- публичен по замыслу. Защищает не он, а политики в конце файла: без них тот
-- же ключ отдаёт содержимое таблиц любому желающему.

create table if not exists step_progress (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null,
  step_id     text not null,
  state       text not null check (state in ('read', 'failed', 'passed')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson_slug, step_id)
);

-- Потолок на размер файла — не косметика: регистрация открытая, ключ
-- публичный, и без него одна вкладка забивает бесплатные 500 МБ целиком.
-- 200 000 символов — два порядка сверх самого большого упражнения курса.
create table if not exists exercise_files (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  slug       text not null,
  file_name  text not null,
  content    text not null check (length(content) < 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, slug, file_name)
);

-- Только последний прогон каждого шага, а не история: истории прогонов в
-- интерфейсе сайта нет, а бесплатная база не то место, где копят журнал.
create table if not exists run_results (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null,
  step_id     text not null,
  passed      integer not null,
  failed      integer not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, lesson_slug, step_id)
);

alter table step_progress  enable row level security;
alter table exercise_files enable row level security;
alter table run_results    enable row level security;

drop policy if exists "own rows" on step_progress;
create policy "own rows" on step_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on exercise_files;
create policy "own rows" on exercise_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on run_results;
create policy "own rows" on run_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Завести проект и накатить схему**

1. https://supabase.com/dashboard → New project. Регион ближайший к читателям, план Free.
2. Project Settings → API: скопировать `Project URL` и `anon public` ключ.
3. SQL Editor → New query → вставить содержимое `supabase/schema.sql` → Run.
4. Table Editor: убедиться, что все три таблицы видны и у каждой стоит значок «RLS enabled».

- [ ] **Step 3: Настроить GitHub OAuth**

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Homepage URL: `https://odiukov.github.io/ai-course-lab/`
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. Скопировать Client ID, сгенерировать Client Secret.
3. Supabase → Authentication → Providers → GitHub: включить, вставить пару.
4. Supabase → Authentication → URL Configuration:
   - Site URL: `https://odiukov.github.io/ai-course-lab/`
   - Redirect URLs: добавить `https://odiukov.github.io/ai-course-lab/auth/` и `http://localhost:4173/auth/` (адрес для локальной проверки собранного `out/`).

Почта не настраивается вовсе: встроенный отправитель Supabase шлёт порядка двух-трёх писем в час, и для открытой регистрации это неработоспособно. OAuth писем не шлёт.

- [ ] **Step 4: Проверить, что RLS действительно закрывает таблицы**

Run (подставив свои значения):

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon key>"

for table in step_progress exercise_files run_results; do
  echo "--- $table"
  curl -s "$SUPABASE_URL/rest/v1/$table?select=*" -H "apikey: $SUPABASE_ANON_KEY"
  echo
done

curl -s -X POST "$SUPABASE_URL/rest/v1/step_progress" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"lesson_slug":"x","step_id":"y","state":"read"}'
```

Expected: три пустых массива `[]` в чтении и ошибка вида `"new row violates row-level security policy"` на вставке. Любой другой результат означает, что политика не встала — вернуться к шагу 2 и не идти дальше.

- [ ] **Step 5: Записать переменные в `.env.example` и README**

Append to `.env.example`:

```bash
# Облачный прогресс статического сайта (npm run site:build).
# Ключ anon публичен по устройству Supabase: он уезжает в HTML страниц, и это
# не утечка — доступ к данным закрывают политики RLS, а не секретность ключа.
# Без этих двух переменных сайт собирается ровно как раньше, без входа.
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Добавить в README.md в раздел «Что где» строку:

```markdown
- `supabase/schema.sql` — схема облачного прогресса статического сайта,
  накатывается руками через SQL Editor в консоли Supabase
```

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql .env.example README.md
git commit -m "feat(site): add supabase schema and row-level security for cloud progress"
```

---

### Task 2: Ключи хранилища одним местом

**Files:**
- Create: `src/lib/site/storage-keys.ts`
- Create: `src/lib/site/storage-keys.test.ts`
- Modify: `src/lib/site/client.ts:4` (переносится `PROGRESS_KEY_PREFIX`)

**Interfaces:**
- Consumes: ничего.
- Produces: константы `PROGRESS_KEY_PREFIX`, `STEP_STATE_KEY_PREFIX`, `EXERCISE_KEY_PREFIX`, `SYNCED_KEY_PREFIX`, `UPDATED_AT_SUFFIX`, `RECOVERY_SUFFIX`, `LOCAL_BACKUP_SUFFIX` — все `string`. `src/lib/site/client.ts` продолжает реэкспортировать `PROGRESS_KEY_PREFIX`, потому что на него ссылается `client.test.ts`.

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/storage-keys.test.ts`:

```ts
// Значения этих строк — контракт с уже опубликованным сайтом: они лежат в
// localStorage браузеров читателей. Тест сторожит именно значения, а не
// существование констант: переименование ключа стирает чужой прогресс.
import { describe, expect, it } from "vitest";
import {
  EXERCISE_KEY_PREFIX,
  LOCAL_BACKUP_SUFFIX,
  PROGRESS_KEY_PREFIX,
  RECOVERY_SUFFIX,
  STEP_STATE_KEY_PREFIX,
  SYNCED_KEY_PREFIX,
  UPDATED_AT_SUFFIX,
} from "./storage-keys";

describe("ключи localStorage", () => {
  it("совпадают с теми, что уже лежат в браузерах читателей", () => {
    expect(PROGRESS_KEY_PREFIX).toBe("course-progress:");
    expect(EXERCISE_KEY_PREFIX).toBe("course-exercise:");
    expect(RECOVERY_SUFFIX).toBe(":recovery");
  });

  it("описывает новые ключи синхронизации", () => {
    expect(STEP_STATE_KEY_PREFIX).toBe("course-step-state:");
    expect(SYNCED_KEY_PREFIX).toBe("course-synced:");
    expect(UPDATED_AT_SUFFIX).toBe(":updatedAt");
    expect(LOCAL_BACKUP_SUFFIX).toBe(":local-backup");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx vitest run src/lib/site/storage-keys.test.ts`
Expected: FAIL, `Failed to resolve import "./storage-keys"`.

- [ ] **Step 3: Написать модуль**

Create `src/lib/site/storage-keys.ts`:

```ts
/**
 * Ключи localStorage сайта — одним местом.
 *
 * Их читают три стороны: клиентские скрипты страниц, миграция прогресса в
 * облако и тесты. Разъехавшиеся значения означают потерянный прогресс у людей,
 * которые уже читают опубликованный сайт, поэтому строки живут в одном файле и
 * закреплены тестом.
 */

/** На каждый урок свой массив id прочитанных шагов. */
export const PROGRESS_KEY_PREFIX = "course-progress:";

/** На каждый урок объект `{ "<step-id>": "read" | "failed" | "passed" }`. */
export const STEP_STATE_KEY_PREFIX = "course-step-state:";

/** Полный текст файла упражнения: `course-exercise:<slug>[:<file>]`. */
export const EXERCISE_KEY_PREFIX = "course-exercise:";

/** Флаг «локальный прогресс уже влит в этот аккаунт»: `course-synced:<user-id>`. */
export const SYNCED_KEY_PREFIX = "course-synced:";

/** Время последней правки файла упражнения в ISO. */
export const UPDATED_AT_SUFFIX = ":updatedAt";

/** Копия файла, в котором не нашлась функция шага. */
export const RECOVERY_SUFFIX = ":recovery";

/** Копия локального текста, проигравшего облачному при первом слиянии. */
export const LOCAL_BACKUP_SUFFIX = ":local-backup";
```

- [ ] **Step 4: Перевести `client.ts` на общий модуль**

Modify `src/lib/site/client.ts`, заменив строку 4 (`export const PROGRESS_KEY_PREFIX = "course-progress:";`) на:

```ts
import { PROGRESS_KEY_PREFIX } from "./storage-keys";

// Реэкспорт ради тестов страниц, которые собирают ключ сами.
export { PROGRESS_KEY_PREFIX };
```

Импортируется ровно то, что используется прямо сейчас: остальные константы приезжают в задаче 5, вместе с кодом, который их читает. Лишний импорт свалил бы `npm run lint` на этом же коммите.

Импорт `HEIGHT_MESSAGE` в строке 1 остаётся на месте.

- [ ] **Step 5: Запустить тесты**

Run: `npm test`
Expected: PASS, включая `src/lib/site/client.test.ts` — реэкспорт сохраняет её импорт рабочим.

- [ ] **Step 6: Commit**

```bash
git add src/lib/site/storage-keys.ts src/lib/site/storage-keys.test.ts src/lib/site/client.ts
git commit -m "refactor(site): collect localStorage key names in one module"
```

---

### Task 3: Правила слияния

**Files:**
- Create: `src/lib/sync/merge.ts`
- Create: `src/lib/sync/merge.test.ts`

**Interfaces:**
- Consumes: ничего (чистый модуль, ни сети, ни `localStorage`).
- Produces:
  - `type StepState = "read" | "failed" | "passed"`
  - `interface StepRow { lessonSlug: string; stepId: string; state: StepState; updatedAt: string }`
  - `interface FileRow { slug: string; fileName: string; content: string; updatedAt?: string }`
  - `function rankOf(state: StepState): number`
  - `function mergeStep(local: StepRow | null, cloud: StepRow | null): StepRow | null`
  - `function mergeSteps(local: StepRow[], cloud: StepRow[]): { merged: StepRow[]; upload: StepRow[] }`
  - `type FileDecision = { action: "upload" | "keep-cloud" | "none"; row: FileRow; backup?: string }`
  - `function mergeFile(local: FileRow | null, cloud: FileRow | null): FileDecision | null`

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/sync/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeFile, mergeStep, mergeSteps, rankOf } from "./merge";

const early = "2026-08-01T10:00:00.000Z";
const late = "2026-08-02T10:00:00.000Z";

function step(stepId: string, state: "read" | "failed" | "passed", updatedAt: string) {
  return { lessonSlug: "lesson-a", stepId, state, updatedAt };
}

describe("rankOf", () => {
  it("ставит passed выше read и failed", () => {
    expect(rankOf("passed")).toBeGreaterThan(rankOf("read"));
    expect(rankOf("passed")).toBeGreaterThan(rankOf("failed"));
    expect(rankOf("read")).toBe(rankOf("failed"));
  });
});

describe("mergeStep", () => {
  it("возвращает единственную сторону, если второй нет", () => {
    expect(mergeStep(step("001", "read", early), null)?.state).toBe("read");
    expect(mergeStep(null, step("001", "passed", early))?.state).toBe("passed");
    expect(mergeStep(null, null)).toBeNull();
  });

  it("не сбрасывает сданный шаг красным прогоном с другого устройства", () => {
    const merged = mergeStep(step("001", "failed", late), step("001", "passed", early));
    expect(merged?.state).toBe("passed");
  });

  it("поднимает шаг до passed, откуда бы passed ни пришёл", () => {
    const merged = mergeStep(step("001", "passed", early), step("001", "read", late));
    expect(merged?.state).toBe("passed");
  });

  it("при равных рангах побеждает более позднее время", () => {
    const merged = mergeStep(step("001", "failed", late), step("001", "read", early));
    expect(merged?.state).toBe("failed");
    expect(merged?.updatedAt).toBe(late);
  });
});

describe("mergeSteps", () => {
  it("объединяет обе стороны и не теряет ни одного шага", () => {
    const { merged } = mergeSteps(
      [step("001", "read", early), step("002", "passed", early)],
      [step("002", "failed", late), step("003", "read", late)],
    );
    expect(merged.map((row) => row.stepId)).toEqual(["001", "002", "003"]);
    expect(merged.find((row) => row.stepId === "002")?.state).toBe("passed");
  });

  it("к отправке помечает только то, чего в облаке ещё нет или что там устарело", () => {
    const { upload } = mergeSteps(
      [step("001", "read", early), step("002", "passed", late), step("003", "read", early)],
      [step("002", "read", early), step("003", "read", early)],
    );
    expect(upload.map((row) => row.stepId).sort()).toEqual(["001", "002"]);
  });
});

describe("mergeFile", () => {
  const local = { slug: "ex", fileName: "exercise.py", content: "local" };
  const cloud = { slug: "ex", fileName: "exercise.py", content: "cloud", updatedAt: early };

  it("заливает локальный текст, когда в облаке строки нет", () => {
    expect(mergeFile(local, null)).toEqual({ action: "upload", row: local });
  });

  it("забирает облачный текст, когда локального нет", () => {
    expect(mergeFile(null, cloud)).toEqual({ action: "keep-cloud", row: cloud });
  });

  it("ничего не делает, когда тексты совпали", () => {
    const same = { ...local, content: "cloud" };
    expect(mergeFile(same, cloud)?.action).toBe("none");
  });

  it("без локальной отметки времени уступает облаку и откладывает копию", () => {
    const decision = mergeFile(local, cloud);
    expect(decision).toEqual({ action: "keep-cloud", row: cloud, backup: "local" });
  });

  it("с отметкой времени решает по ней", () => {
    const newer = { ...local, updatedAt: late };
    expect(mergeFile(newer, cloud)).toEqual({ action: "upload", row: newer });

    const older = { ...local, updatedAt: early };
    const fresherCloud = { ...cloud, updatedAt: late };
    expect(mergeFile(older, fresherCloud)).toEqual({ action: "keep-cloud", row: fresherCloud });
  });

  it("на двух пустых сторонах не решает ничего", () => {
    expect(mergeFile(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx vitest run src/lib/sync/merge.test.ts`
Expected: FAIL, `Failed to resolve import "./merge"`.

- [ ] **Step 3: Написать модуль**

Create `src/lib/sync/merge.ts`:

```ts
/**
 * Правила слияния локального прогресса с облачным.
 *
 * Ни сети, ни localStorage: на вход приходят простые объекты, на выход —
 * решение. Всё, что требует размышления, живёт здесь и проверяется обычными
 * тестами, а бандл со Supabase остаётся последовательностью вызовов.
 *
 * Общий принцип у всех правил один: никогда не терять уже достигнутое.
 */

export type StepState = "read" | "failed" | "passed";

export interface StepRow {
  lessonSlug: string;
  stepId: string;
  state: StepState;
  updatedAt: string;
}

export interface FileRow {
  slug: string;
  fileName: string;
  content: string;
  /** Отметки времени нет у файлов, сохранённых до появления синхронизации. */
  updatedAt?: string;
}

export type FileDecision = {
  action: "upload" | "keep-cloud" | "none";
  row: FileRow;
  /** Локальный текст, проигравший облачному: его откладывают в копию. */
  backup?: string;
};

/**
 * Ранг состояния.
 *
 * `read` и `failed` равны намеренно: красный прогон на втором устройстве не
 * должен сбрасывать шаг, уже сданный на первом, но и прочтение не отменяет
 * красного прогона — они про разное и стоят на одной ступени.
 */
export function rankOf(state: StepState): number {
  return state === "passed" ? 2 : 1;
}

export function mergeStep(local: StepRow | null, cloud: StepRow | null): StepRow | null {
  if (!local) return cloud;
  if (!cloud) return local;
  if (rankOf(local.state) !== rankOf(cloud.state)) {
    return rankOf(local.state) > rankOf(cloud.state) ? local : cloud;
  }
  return local.updatedAt >= cloud.updatedAt ? local : cloud;
}

function keyOf(row: StepRow): string {
  return `${row.lessonSlug} ${row.stepId}`;
}

/**
 * Слияние всех шагов сразу.
 *
 * `upload` — только то, что в облаке отсутствует или отличается от
 * победителя: отправлять обратно строку, которая и так там лежит, незачем.
 */
export function mergeSteps(
  local: StepRow[],
  cloud: StepRow[],
): { merged: StepRow[]; upload: StepRow[] } {
  const cloudByKey = new Map(cloud.map((row) => [keyOf(row), row]));
  const localByKey = new Map(local.map((row) => [keyOf(row), row]));
  const keys = [...new Set([...localByKey.keys(), ...cloudByKey.keys()])].sort();

  const merged: StepRow[] = [];
  const upload: StepRow[] = [];
  for (const key of keys) {
    const winner = mergeStep(localByKey.get(key) ?? null, cloudByKey.get(key) ?? null);
    if (!winner) continue;
    merged.push(winner);
    const known = cloudByKey.get(key);
    if (!known || known.state !== winner.state || known.updatedAt !== winner.updatedAt) {
      upload.push(winner);
    }
  }
  return { merged, upload };
}

/**
 * Решение по одному файлу упражнения.
 *
 * Единственное место, где честного правила нет: у текста, сохранённого до
 * появления синхронизации, отметки времени не существует, и вычислить, какой
 * из двух разошедшихся текстов новее, нечем. Тогда побеждает облако, а
 * локальный текст откладывается в копию — молча терять написанный код нельзя,
 * а угадывать без отметки времени тем более.
 */
export function mergeFile(local: FileRow | null, cloud: FileRow | null): FileDecision | null {
  if (!local && !cloud) return null;
  if (!cloud) return { action: "upload", row: local as FileRow };
  if (!local) return { action: "keep-cloud", row: cloud };
  if (local.content === cloud.content) return { action: "none", row: cloud };
  if (!local.updatedAt) return { action: "keep-cloud", row: cloud, backup: local.content };
  return local.updatedAt > (cloud.updatedAt ?? "")
    ? { action: "upload", row: local }
    : { action: "keep-cloud", row: cloud };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run src/lib/sync/merge.test.ts`
Expected: PASS, 13 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/merge.ts src/lib/sync/merge.test.ts
git commit -m "feat(sync): add merge rules for cloud and local progress"
```

---

### Task 4: Разбор локального хранилища и план миграции

**Files:**
- Create: `src/lib/sync/migrate.ts`
- Create: `src/lib/sync/migrate.test.ts`

**Interfaces:**
- Consumes: `StepRow`, `FileRow`, `mergeSteps`, `mergeFile` из `src/lib/sync/merge.ts`; константы из `src/lib/site/storage-keys.ts`.
- Produces:
  - `type StorageSnapshot = Record<string, string>`
  - `interface LocalProgress { steps: StepRow[]; files: FileRow[] }`
  - `function readLocalProgress(snapshot: StorageSnapshot, now: string): LocalProgress`
  - `interface MigrationPlan { steps: StepRow[]; files: FileRow[]; writes: Record<string, string>; backups: number }`
  - `function planMigration(local: LocalProgress, cloud: LocalProgress): MigrationPlan`

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/sync/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planMigration, readLocalProgress } from "./migrate";

const now = "2026-08-24T12:00:00.000Z";

describe("readLocalProgress", () => {
  it("превращает массив прочитанных в строки состояния", () => {
    const local = readLocalProgress(
      { "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]) },
      now,
    );
    expect(local.steps).toEqual([
      { lessonSlug: "lesson-a", stepId: "001-a", state: "read", updatedAt: now },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "read", updatedAt: now },
    ]);
  });

  it("поднимает состояние практики над простым прочтением", () => {
    const local = readLocalProgress(
      {
        "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]),
        "course-step-state:lesson-a": JSON.stringify({ "002-b": "passed" }),
      },
      now,
    );
    expect(local.steps.find((row) => row.stepId === "002-b")?.state).toBe("passed");
    expect(local.steps.find((row) => row.stepId === "001-a")?.state).toBe("read");
  });

  it("разбирает ключи упражнений, включая многофайловые", () => {
    const local = readLocalProgress(
      {
        "course-exercise:ex-a": "one file",
        "course-exercise:ex-b:main.py": "multi file",
        "course-exercise:ex-b:main.py:updatedAt": "2026-08-20T00:00:00.000Z",
      },
      now,
    );
    expect(local.files).toEqual([
      { slug: "ex-a", fileName: "exercise.py", content: "one file" },
      {
        slug: "ex-b",
        fileName: "main.py",
        content: "multi file",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
  });

  it("пропускает служебные суффиксы", () => {
    const local = readLocalProgress(
      {
        "course-exercise:ex-a": "code",
        "course-exercise:ex-a:recovery": "broken",
        "course-exercise:ex-a:local-backup": "older",
      },
      now,
    );
    expect(local.files).toHaveLength(1);
    expect(local.files[0].content).toBe("code");
  });

  it("переживает мусор в хранилище", () => {
    const local = readLocalProgress(
      { "course-progress:lesson-a": "{не json", "course-step-state:lesson-a": "[]" },
      now,
    );
    expect(local.steps).toEqual([]);
    expect(local.files).toEqual([]);
  });
});

describe("planMigration", () => {
  const local = {
    steps: [
      { lessonSlug: "lesson-a", stepId: "001-a", state: "read" as const, updatedAt: now },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "passed" as const, updatedAt: now },
    ],
    files: [{ slug: "ex-a", fileName: "exercise.py", content: "local code" }],
  };

  it("заливает всё, когда облако пустое", () => {
    const plan = planMigration(local, { steps: [], files: [] });
    expect(plan.steps).toHaveLength(2);
    expect(plan.files).toHaveLength(1);
    expect(plan.backups).toBe(0);
  });

  it("складывает результат слияния обратно в ключи localStorage", () => {
    const plan = planMigration(local, {
      steps: [
        { lessonSlug: "lesson-a", stepId: "003-c", state: "read", updatedAt: now },
      ],
      files: [],
    });
    expect(JSON.parse(plan.writes["course-progress:lesson-a"])).toEqual([
      "001-a",
      "002-b",
      "003-c",
    ]);
    expect(JSON.parse(plan.writes["course-step-state:lesson-a"])).toEqual({ "002-b": "passed" });
  });

  it("при разошедшемся коде без отметки времени кладёт копию и берёт облачный", () => {
    const plan = planMigration(local, {
      steps: [],
      files: [
        {
          slug: "ex-a",
          fileName: "exercise.py",
          content: "cloud code",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    });
    expect(plan.files).toHaveLength(0);
    expect(plan.backups).toBe(1);
    expect(plan.writes["course-exercise:ex-a"]).toBe("cloud code");
    expect(plan.writes["course-exercise:ex-a:local-backup"]).toBe("local code");
  });

  it("на повторном прогоне не находит, что отправлять", () => {
    const cloud = { steps: local.steps, files: local.files };
    const plan = planMigration(local, cloud);
    expect(plan.steps).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.backups).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx vitest run src/lib/sync/migrate.test.ts`
Expected: FAIL, `Failed to resolve import "./migrate"`.

- [ ] **Step 3: Написать модуль**

Create `src/lib/sync/migrate.ts`:

```ts
/**
 * Разбор локального хранилища и план первого слияния с облаком.
 *
 * На вход приходит снимок localStorage обычным объектом — так модуль остаётся
 * чистым и проверяется без браузера. Решение о том, что отправить, что
 * записать обратно и что отложить в копию, принимается здесь целиком.
 */
import {
  EXERCISE_KEY_PREFIX,
  LOCAL_BACKUP_SUFFIX,
  PROGRESS_KEY_PREFIX,
  RECOVERY_SUFFIX,
  STEP_STATE_KEY_PREFIX,
  UPDATED_AT_SUFFIX,
} from "../site/storage-keys";
import { type FileRow, mergeFile, mergeSteps, type StepRow, type StepState } from "./merge";

export type StorageSnapshot = Record<string, string>;

export interface LocalProgress {
  steps: StepRow[];
  files: FileRow[];
}

export interface MigrationPlan {
  /** Строки шагов на отправку в облако. */
  steps: StepRow[];
  /** Файлы упражнений на отправку в облако. */
  files: FileRow[];
  /** Что записать обратно в localStorage после слияния. */
  writes: Record<string, string>;
  /** Сколько локальных текстов уступило облачным и уехало в копию. */
  backups: number;
}

const STATES: StepState[] = ["read", "failed", "passed"];

function parse<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** Служебные суффиксы: это не файлы упражнения, а вспомогательные копии. */
function isServiceKey(key: string): boolean {
  return (
    key.endsWith(RECOVERY_SUFFIX) ||
    key.endsWith(LOCAL_BACKUP_SUFFIX) ||
    key.endsWith(UPDATED_AT_SUFFIX)
  );
}

export function readLocalProgress(snapshot: StorageSnapshot, now: string): LocalProgress {
  const byStep = new Map<string, StepRow>();

  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(PROGRESS_KEY_PREFIX)) continue;
    const lessonSlug = key.slice(PROGRESS_KEY_PREFIX.length);
    const ids = parse<unknown>(raw, []);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      byStep.set(`${lessonSlug} ${id}`, {
        lessonSlug,
        stepId: id,
        state: "read",
        updatedAt: now,
      });
    }
  }

  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(STEP_STATE_KEY_PREFIX)) continue;
    const lessonSlug = key.slice(STEP_STATE_KEY_PREFIX.length);
    const states = parse<Record<string, unknown>>(raw, {});
    if (Array.isArray(states) || typeof states !== "object") continue;
    for (const [stepId, state] of Object.entries(states)) {
      if (typeof state !== "string" || !STATES.includes(state as StepState)) continue;
      byStep.set(`${lessonSlug} ${stepId}`, {
        lessonSlug,
        stepId,
        state: state as StepState,
        updatedAt: now,
      });
    }
  }

  const files: FileRow[] = [];
  for (const [key, content] of Object.entries(snapshot)) {
    if (!key.startsWith(EXERCISE_KEY_PREFIX) || isServiceKey(key)) continue;
    const rest = key.slice(EXERCISE_KEY_PREFIX.length);
    const separator = rest.indexOf(":");
    // Одиночное упражнение хранится без имени файла; имя exercise.py — то же
    // самое, что подставляет страница практики, когда файл в уроке один.
    const slug = separator === -1 ? rest : rest.slice(0, separator);
    const fileName = separator === -1 ? "exercise.py" : rest.slice(separator + 1);
    const updatedAt = snapshot[key + UPDATED_AT_SUFFIX];
    files.push(updatedAt ? { slug, fileName, content, updatedAt } : { slug, fileName, content });
  }

  return {
    steps: [...byStep.values()].sort((a, b) =>
      `${a.lessonSlug}${a.stepId}`.localeCompare(`${b.lessonSlug}${b.stepId}`),
    ),
    files: files.sort((a, b) => `${a.slug}${a.fileName}`.localeCompare(`${b.slug}${b.fileName}`)),
  };
}

function fileKey(row: FileRow, multi: boolean): string {
  return multi
    ? `${EXERCISE_KEY_PREFIX}${row.slug}:${row.fileName}`
    : `${EXERCISE_KEY_PREFIX}${row.slug}`;
}

export function planMigration(local: LocalProgress, cloud: LocalProgress): MigrationPlan {
  const { merged, upload } = mergeSteps(local.steps, cloud.steps);

  const writes: Record<string, string> = {};
  const readByLesson = new Map<string, string[]>();
  const stateByLesson = new Map<string, Record<string, StepState>>();
  for (const row of merged) {
    const ids = readByLesson.get(row.lessonSlug) ?? [];
    ids.push(row.stepId);
    readByLesson.set(row.lessonSlug, ids);
    if (row.state !== "read") {
      const states = stateByLesson.get(row.lessonSlug) ?? {};
      states[row.stepId] = row.state;
      stateByLesson.set(row.lessonSlug, states);
    }
  }
  for (const [lessonSlug, ids] of readByLesson) {
    writes[PROGRESS_KEY_PREFIX + lessonSlug] = JSON.stringify(ids);
  }
  for (const [lessonSlug, states] of stateByLesson) {
    writes[STEP_STATE_KEY_PREFIX + lessonSlug] = JSON.stringify(states);
  }

  const localFiles = new Map(local.files.map((row) => [`${row.slug} ${row.fileName}`, row]));
  const cloudFiles = new Map(cloud.files.map((row) => [`${row.slug} ${row.fileName}`, row]));
  const keys = [...new Set([...localFiles.keys(), ...cloudFiles.keys()])].sort();

  const files: FileRow[] = [];
  let backups = 0;
  for (const key of keys) {
    const localRow = localFiles.get(key) ?? null;
    const cloudRow = cloudFiles.get(key) ?? null;
    const decision = mergeFile(localRow, cloudRow);
    if (!decision) continue;

    if (decision.action === "upload") {
      files.push(decision.row);
      continue;
    }
    if (decision.action === "none") continue;

    // Облачный текст побеждает: он должен оказаться и в localStorage, иначе
    // страница продолжит показывать локальный.
    const multi = decision.row.fileName !== "exercise.py";
    writes[fileKey(decision.row, multi)] = decision.row.content;
    if (decision.row.updatedAt) {
      writes[fileKey(decision.row, multi) + UPDATED_AT_SUFFIX] = decision.row.updatedAt;
    }
    if (decision.backup !== undefined) {
      writes[fileKey(decision.row, multi) + LOCAL_BACKUP_SUFFIX] = decision.backup;
      backups += 1;
    }
  }

  return { steps: upload, files, writes, backups };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run src/lib/sync/migrate.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/migrate.ts src/lib/sync/migrate.test.ts
git commit -m "feat(sync): read local progress and plan the first merge"
```

---

### Task 5: Запись состояния шага и времени правки в браузере

**Files:**
- Modify: `src/lib/site/client.ts` (`STORE`, `PROGRESS_SCRIPT`, `QUIZ_SCRIPT`, `EXERCISE_SCRIPT`)
- Modify: `src/lib/site/render.tsx:200` (плашка синхронизации в панели практики)
- Modify: `src/lib/site/client.test.ts`

**Interfaces:**
- Consumes: константы из `src/lib/site/storage-keys.ts`.
- Produces: ключ `course-step-state:<lesson-slug>` со значением `{"<step-id>": "read"|"failed"|"passed"}`; ключ `<ключ упражнения>:updatedAt` в ISO; в разметке практики узел `<p class="practice-notice" data-sync-notice hidden></p>`; в клиентском коде функции `readStates(slug)` и `markState(slug, stepId, state)` внутри `STORE`.

Задача самостоятельна: сети в ней ещё нет, но сайт после неё уже помнит, какие шаги сданы.

- [ ] **Step 1: Написать падающие тесты**

Append to `src/lib/site/client.test.ts` (рядом с существующими блоками, вспомогательные `open` и `model` уже есть в файле):

```ts
describe("состояние шага", () => {
  const stateKey = "course-step-state:lesson-a";

  it("отмечает шаг сданным, когда все вопросы отвечены верно", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [
            { question: "Раз?", options: ["Да", "Нет"], correct: 0 },
            { question: "Два?", options: ["Да", "Нет"], correct: 1 },
          ],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);

    const questions = [...window.document.querySelectorAll("[data-question]")];
    (questions[0].querySelectorAll("[data-option]")[0] as HTMLElement).click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBeUndefined();

    (questions[1].querySelectorAll("[data-option]")[1] as HTMLElement).click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBe("passed");
  });

  it("отмечает шаг проваленным на неверном ответе", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [{ question: "Раз?", options: ["Да", "Нет"], correct: 0 }],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);

    const wrong = window.document.querySelectorAll("[data-option]")[1] as HTMLElement;
    wrong.click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBe("failed");
  });

  it("не сбрасывает сданный шаг последующим неверным ответом", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [{ question: "Раз?", options: ["Да", "Нет"], correct: 0 }],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);
    window.localStorage.setItem(stateKey, JSON.stringify({ "002-b": "passed" }));

    const wrong = window.document.querySelectorAll("[data-option]")[1] as HTMLElement;
    wrong.click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBe("passed");
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx vitest run src/lib/site/client.test.ts`
Expected: FAIL — `expect(...).toBe("passed")` получает `undefined`: состояние никуда не пишется.

- [ ] **Step 3: Добавить работу с состоянием в `STORE`**

Modify `src/lib/site/client.ts`, расширив импорт из задачи 2 до того, что теперь действительно используется:

```ts
import { PROGRESS_KEY_PREFIX, STEP_STATE_KEY_PREFIX, UPDATED_AT_SUFFIX } from "./storage-keys";
```

Затем — в конец шаблона `STORE` (перед закрывающей обратной кавычкой, после `lessonData`):

```js
var STATE_PREFIX = ${JSON.stringify(STEP_STATE_KEY_PREFIX)};

function readStates(slug) {
  try {
    var raw = localStorage.getItem(STATE_PREFIX + slug);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

/**
 * Состояние практики шага.
 *
 * passed не сбрасывается ничем: красный прогон после зелёного означает, что
 * человек полез что-то менять в уже сданном шаге, а не что шаг разучился.
 */
function markState(slug, stepId, state) {
  var rank = { read: 1, failed: 1, passed: 2 };
  var states = readStates(slug);
  if ((rank[states[stepId]] || 0) > (rank[state] || 0)) return states;
  states[stepId] = state;
  try {
    localStorage.setItem(STATE_PREFIX + slug, JSON.stringify(states));
  } catch (error) {
    // Приватное окно: состояние не переживёт перезагрузку.
  }
  if (window.CourseSync) window.CourseSync.putStep(slug, stepId, state);
  return states;
}
```

Вызов `window.CourseSync` здесь появляется заранее и до задачи 7 никогда не срабатывает: бандла синхронизации ещё нет, `window.CourseSync` не определён.

- [ ] **Step 4: Подключить `STORE` к скрипту квиза и отмечать состояние**

Modify `src/lib/site/client.ts`, заменив тело `QUIZ_SCRIPT` на обёрнутое в IIFE с общим хранилищем:

```ts
export const QUIZ_SCRIPT = `
(function () {
${STORE}

var lesson = lessonData("[data-lesson]");

document.querySelectorAll("[data-quiz]").forEach(function (root) {
  var source = root.querySelector("[data-quiz-answers]");
  if (!source) return;
  var answers = JSON.parse(source.textContent || "[]");
  // Шаг сдан, когда верно отвечены все вопросы блока, а не первый попавшийся.
  var correct = {};
  var total = root.querySelectorAll("[data-question]").length;

  root.querySelectorAll("[data-question]").forEach(function (question) {
    var index = Number(question.getAttribute("data-question"));
    var answer = answers[index];
    if (!answer) return;
    var explanation = question.querySelector("[data-explanation]");

    question.querySelectorAll("[data-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        var chosen = Number(button.getAttribute("data-option"));
        question.querySelectorAll("[data-option]").forEach(function (other) {
          other.classList.remove("is-chosen", "is-wrong");
          if (Number(other.getAttribute("data-option")) === answer.correct) {
            other.classList.add("is-correct");
          }
        });
        button.classList.add(chosen === answer.correct ? "is-chosen" : "is-wrong");
        if (explanation && answer.explanation) {
          explanation.textContent = answer.explanation;
          explanation.hidden = false;
        }
        if (!lesson) return;
        if (chosen === answer.correct) {
          correct[index] = true;
          if (Object.keys(correct).length === total) {
            markState(lesson.slug, lesson.stepId, "passed");
          }
        } else {
          markState(lesson.slug, lesson.stepId, "failed");
        }
      });
    });
  });
});
})();
`;
```

- [ ] **Step 5: Запустить тесты квиза**

Run: `npx vitest run src/lib/site/client.test.ts`
Expected: PASS — все три новых теста зелёные, старые не тронуты.

- [ ] **Step 6: Отмечать состояние по итогу прогона тестов**

Modify `src/lib/site/client.ts`: в начало `EXERCISE_SCRIPT` (сразу после `(function () {`) вставить общее хранилище и данные урока:

```js
${STORE}

var lesson = lessonData("[data-lesson]");
```

В функции `render(report)`, сразу после строки, где выставляется `status.className` по итогам прогона, добавить:

```js
    if (lesson && total > 0) {
      var verdict = passed === total ? "passed" : "failed";
      markState(lesson.slug, lesson.stepId, verdict);
      if (window.CourseSync) {
        window.CourseSync.putRun(lesson.slug, lesson.stepId, passed, total - passed);
      }
    }
```

Ветка `report.loadError` состояние не трогает: файл не разобрался — это поломка, а не провал попытки.

- [ ] **Step 7: Писать время правки файла упражнения**

Modify `src/lib/site/client.ts`, функция `save()` в `EXERCISE_SCRIPT` — заменить тело `try` на:

```js
    try {
      localStorage.setItem(storageKey, full);
      localStorage.setItem(storageKey + ${JSON.stringify(UPDATED_AT_SUFFIX)}, new Date().toISOString());
    } catch (error) {
      // Приватное окно: код не переживёт перезагрузку, писать всё равно можно.
    }
    if (window.CourseSync) window.CourseSync.putFile(data.slug, activeFile, full);
```

`save()` вызывается на каждое нажатие клавиши, поэтому отправку придерживает дебаунс — но не здесь, а внутри `putFile` в задаче 6: страница не должна знать про сеть больше, чем «вот новый текст».

- [ ] **Step 8: Добавить узел плашки в панель практики**

Modify `src/lib/site/render.tsx:200`, добавив строку перед `<script type="application/json" data-exercise>`:

```html
<p class="practice-notice" data-sync-notice hidden></p>
```

И в `src/styles/site.css` добавить оформление:

```css
.practice-notice {
  margin: 0.75rem 0 0;
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--accent);
  font-size: 0.9rem;
}
```

- [ ] **Step 9: Прогнать всё и закоммитить**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

```bash
git add src/lib/site/client.ts src/lib/site/client.test.ts src/lib/site/render.tsx src/styles/site.css
git commit -m "feat(site): remember whether a practice step was passed or failed"
```

---

### Task 6: Бандл синхронизации, вход и страница возврата

**Files:**
- Create: `src/site-auth/auth.ts`
- Modify: `src/lib/site/render.tsx` (`htmlDocument`, новая `renderAuthPage`)
- Modify: `scripts/build-site.mts` (`buildAuth`, запись `auth/index.html`, подключение модуля)
- Modify: `package.json` (зависимость `@supabase/supabase-js`)

**Interfaces:**
- Consumes: `readLocalProgress`, `planMigration` из `src/lib/sync/migrate.ts`; `StepRow`, `FileRow` из `src/lib/sync/merge.ts`; константы из `src/lib/site/storage-keys.ts`.
- Produces: глобальный объект
  ```ts
  window.CourseSync = {
    putStep(lessonSlug: string, stepId: string, state: string): void;
    putFile(slug: string, fileName: string, content: string): void;
    putRun(lessonSlug: string, stepId: string, passed: number, failed: number): void;
  };
  ```
  события DOM `course-sync-progress` (прогресс подтянулся и записан в `localStorage`) и `course-sync-file` с `detail: { slug, fileName, backup: boolean }`; функция `renderAuthPage({ basePath }: { basePath: string }): string`; атрибут `data-base` на `<body>` всех страниц.

- [ ] **Step 1: Поставить клиент Supabase**

Run: `npm install @supabase/supabase-js`
Expected: пакет в `dependencies`, `package-lock.json` обновлён.

- [ ] **Step 2: Отдать страницам их basePath**

Modify `src/lib/site/render.tsx`, в `htmlDocument` заменить `<body>` на:

```ts
<body data-base="${options.basePath}">
```

Бандлу нужен базовый путь для адреса возврата, а другого способа узнать его у страницы нет: `location.pathname` на шаге урока про базу ничего не говорит.

- [ ] **Step 3: Написать точку входа синхронизации**

Create `src/site-auth/auth.ts`:

```ts
// Вход через GitHub и облачный прогресс статического сайта.
//
// Собирается esbuild-ом в out/assets/auth.js и кладётся рядом с сайтом — как
// редактор, без внешних CDN. Если переменных сборки нет, файла нет вовсе, и
// страницы работают ровно как раньше: весь код ниже висит на window.CourseSync,
// а inline-скрипты страниц проверяют его существование перед вызовом.
//
// Local-first: localStorage уже записан к моменту, когда сюда приходит вызов.
// Сеть здесь — зеркало, и её отказ ничего не ломает.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  EXERCISE_KEY_PREFIX,
  PROGRESS_KEY_PREFIX,
  STEP_STATE_KEY_PREFIX,
  SYNCED_KEY_PREFIX,
} from "../lib/site/storage-keys";
import type { FileRow, StepRow } from "../lib/sync/merge";
import { planMigration, readLocalProgress, type StorageSnapshot } from "../lib/sync/migrate";

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

declare global {
  interface Window {
    CourseSync?: {
      putStep(lessonSlug: string, stepId: string, state: string): void;
      putFile(slug: string, fileName: string, content: string): void;
      putRun(lessonSlug: string, stepId: string, passed: number, failed: number): void;
    };
  }
}

const client: SupabaseClient = createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

const basePath = document.body.getAttribute("data-base") ?? "";
let session: Session | null = null;

const ready = client.auth
  .getSession()
  .then(({ data }) => {
    session = data.session;
    return session;
  })
  .catch(() => null);

client.auth.onAuthStateChange((_event, next) => {
  session = next;
  paintButton();
});

/** Снимок localStorage обычным объектом: разбор живёт в чистом модуле. */
function snapshot(): StorageSnapshot {
  const result: StorageSnapshot = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      !key.startsWith(PROGRESS_KEY_PREFIX) &&
      !key.startsWith(STEP_STATE_KEY_PREFIX) &&
      !key.startsWith(EXERCISE_KEY_PREFIX)
    ) {
      continue;
    }
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

function write(writes: Record<string, string>): void {
  for (const [key, value] of Object.entries(writes)) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Приватное окно: слияние доживёт до конца вкладки и не дальше.
    }
  }
}

async function pullCloud(): Promise<{ steps: StepRow[]; files: FileRow[] }> {
  const [steps, files] = await Promise.all([
    client.from("step_progress").select("lesson_slug, step_id, state, updated_at"),
    client.from("exercise_files").select("slug, file_name, content, updated_at"),
  ]);
  return {
    steps: (steps.data ?? []).map((row) => ({
      lessonSlug: row.lesson_slug as string,
      stepId: row.step_id as string,
      state: row.state as StepRow["state"],
      updatedAt: row.updated_at as string,
    })),
    files: (files.data ?? []).map((row) => ({
      slug: row.slug as string,
      fileName: row.file_name as string,
      content: row.content as string,
      updatedAt: row.updated_at as string,
    })),
  };
}

/**
 * Первое слияние после входа.
 *
 * Выполняется один раз на пару «браузер + пользователь»: флаг в localStorage.
 * Локальные ключи не удаляются никогда — выход из аккаунта не должен
 * оставлять человека с пустым курсом.
 */
export async function migrateOnce(user: string): Promise<{ steps: number; files: number; backups: number }> {
  const flag = SYNCED_KEY_PREFIX + user;
  const cloud = await pullCloud();
  const local = readLocalProgress(snapshot(), new Date().toISOString());
  const plan = planMigration(local, cloud);

  if (plan.steps.length > 0) {
    await client.from("step_progress").upsert(
      plan.steps.map((row) => ({
        user_id: user,
        lesson_slug: row.lessonSlug,
        step_id: row.stepId,
        state: row.state,
        updated_at: row.updatedAt,
      })),
    );
  }
  if (plan.files.length > 0) {
    await client.from("exercise_files").upsert(
      plan.files.map((row) => ({
        user_id: user,
        slug: row.slug,
        file_name: row.fileName,
        content: row.content,
        updated_at: row.updatedAt ?? new Date().toISOString(),
      })),
    );
  }

  write(plan.writes);
  try {
    localStorage.setItem(flag, new Date().toISOString());
  } catch {
    // Без флага миграция просто повторится: она идемпотентна.
  }
  return { steps: plan.steps.length, files: plan.files.length, backups: plan.backups };
}

export function alreadyMigrated(user: string): boolean {
  try {
    return localStorage.getItem(SYNCED_KEY_PREFIX + user) !== null;
  } catch {
    return false;
  }
}

async function signIn(): Promise<void> {
  const here = window.location.pathname + window.location.search;
  const redirectTo = `${window.location.origin}${basePath}/auth/?next=${encodeURIComponent(here)}`;
  await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo } });
}

/** Кнопка входа рисуется скриптом: шапки у трёх видов страниц разные. */
function paintButton(): void {
  const header = document.querySelector("header");
  if (!header) return;

  let button = header.querySelector("[data-auth]") as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "nav-button auth-button";
    button.setAttribute("data-auth", "");
    header.appendChild(button);
  }

  if (session) {
    const name = (session.user.user_metadata?.user_name as string) ?? "аккаунт";
    button.textContent = `${name} · выйти`;
    button.onclick = () => {
      void client.auth.signOut();
    };
  } else {
    button.textContent = "Войти через GitHub";
    button.onclick = () => {
      void signIn();
    };
  }
}

/**
 * Отправка без ожидания.
 *
 * `catch` обязателен: localStorage уже записан, страница живёт дальше, и
 * оборванная сеть не должна ни ронять необработанное отклонение в консоль, ни
 * тем более что-то показывать человеку. Следующее действие и есть повтор.
 */
/** Отложенные отправки файлов: ключ — «slug:имя файла». */
const fileTimers = new Map<string, number>();

function push(run: (user: string) => PromiseLike<unknown>): void {
  void ready
    .then(() => {
      if (!session) return;
      return run(session.user.id);
    })
    .catch(() => undefined);
}

window.CourseSync = {
  putStep(lessonSlug, stepId, state) {
    push((user) =>
      client.from("step_progress").upsert({
        user_id: user,
        lesson_slug: lessonSlug,
        step_id: stepId,
        state,
        updated_at: new Date().toISOString(),
      }),
    );
  },
  putFile(slug, fileName, content) {
    // Текст приходит на каждое нажатие клавиши. В облако уезжает то, что
    // осталось на экране через две секунды после последней правки — ровно как
    // локальное приложение пишет файл на диск.
    const key = `${slug}:${fileName}`;
    const pending = fileTimers.get(key);
    if (pending !== undefined) window.clearTimeout(pending);
    fileTimers.set(
      key,
      window.setTimeout(() => {
        fileTimers.delete(key);
        push((user) =>
          client.from("exercise_files").upsert({
            user_id: user,
            slug,
            file_name: fileName,
            content,
            updated_at: new Date().toISOString(),
          }),
        );
      }, 2000),
    );
  },
  putRun(lessonSlug, stepId, passed, failed) {
    push((user) =>
      client.from("run_results").upsert({
        user_id: user,
        lesson_slug: lessonSlug,
        step_id: stepId,
        passed,
        failed,
        created_at: new Date().toISOString(),
      }),
    );
  },
};

void ready.then(() => paintButton());
```

- [ ] **Step 4: Написать страницу возврата**

Modify `src/lib/site/render.tsx`, добавив экспорт рядом с остальными `render*`:

```tsx
/**
 * Страница возврата после входа через GitHub.
 *
 * Единственное место, где виден ход первого слияния. Разбор токена из адреса
 * делает клиент Supabase, сюда он приходит уже с сессией.
 */
export function renderAuthPage(options: { basePath: string }): string {
  return htmlDocument({
    title: "Вход — Курс",
    basePath: options.basePath,
    body: `<header class="index-header"><h1>Вход</h1></header>
<main class="lesson">
<p class="run-status" data-auth-status>Проверяю вход…</p>
<a class="nav-button" data-auth-back href="${options.basePath}/">К курсу</a>
</main>`,
    modules: [`${options.basePath}/assets/auth.js`],
    scripts: [AUTH_PAGE_SCRIPT],
  });
}
```

И добавить в `src/lib/site/client.ts`:

```ts
/**
 * Страница `/auth/`: показать итог входа и увести обратно.
 *
 * Адрес возврата приходит строкой запроса, поэтому проверяется на то, что это
 * путь внутри самого сайта: без проверки страница входа превращается в
 * открытый редирект на чужой сайт.
 */
export const AUTH_PAGE_SCRIPT = `
(function () {
  var status = document.querySelector("[data-auth-status]");
  var base = document.body.getAttribute("data-base") || "";

  function safeNext() {
    var raw = new URLSearchParams(window.location.search).get("next");
    if (!raw) return base + "/";
    if (raw.charAt(0) !== "/" || raw.charAt(1) === "/") return base + "/";
    if (base && raw.indexOf(base + "/") !== 0) return base + "/";
    return raw;
  }

  window.addEventListener("course-sync-ready", function (event) {
    var detail = event.detail || {};
    if (!detail.user) {
      if (status) status.textContent = "Войти не удалось: " + (detail.error || "неизвестная причина");
      return;
    }
    if (status) {
      status.textContent = detail.migrated
        ? "Прогресс с этого устройства влит в аккаунт: шагов " + detail.steps +
          ", файлов " + detail.files +
          (detail.backups > 0 ? ", отложено копий кода " + detail.backups : "")
        : "Вход выполнен.";
    }
    window.setTimeout(function () {
      window.location.replace(safeNext());
    }, detail.backups > 0 ? 4000 : 1200);
  });
})();
`;
```

- [ ] **Step 5: Досылать событие входа из бандла**

Modify `src/site-auth/auth.ts`, заменив последнюю строку `void ready.then(() => paintButton());` на:

```ts
void ready.then(async () => {
  paintButton();
  if (!session) {
    window.dispatchEvent(new CustomEvent("course-sync-ready", { detail: { user: null } }));
    return;
  }
  const user = session.user.id;
  const fresh = !alreadyMigrated(user);
  let detail: Record<string, unknown> = { user, migrated: false };
  if (fresh) {
    try {
      const result = await migrateOnce(user);
      detail = { user, migrated: true, ...result };
    } catch (error) {
      detail = { user, migrated: false, error: String(error) };
    }
  }
  window.dispatchEvent(new CustomEvent("course-sync-ready", { detail }));
});
```

- [ ] **Step 6: Собрать бандл и написать страницу в сборке**

Modify `scripts/build-site.mts`, добавив рядом с `buildEditor`:

```ts
/**
 * Вход и синхронизация одним файлом.
 *
 * Без переменных окружения бандл не собирается вовсе: сайт тогда получается
 * ровно такой, каким был до появления аккаунтов, и чужая сборка репозитория
 * не спотыкается об отсутствие проекта Supabase.
 */
async function buildAuth(): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("SUPABASE_URL/SUPABASE_ANON_KEY не заданы — сайт собирается без входа");
    return false;
  }
  await build({
    entryPoints: [path.join(root, "src", "site-auth", "auth.ts")],
    outfile: path.join(outDir, "assets", "auth.js"),
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    define: {
      __SUPABASE_URL__: JSON.stringify(url),
      __SUPABASE_ANON_KEY__: JSON.stringify(key),
    },
    logLevel: "warning",
  });
  return true;
}
```

В `main()`, после `await buildEditor();`:

```ts
  const withAuth = await buildAuth();
  if (withAuth) write(path.join("auth", "index.html"), renderAuthPage({ basePath }));
```

И передать флаг в рендер страниц: в вызовы `renderLessonIndexPage`, `renderStepPage` и `renderIndexPage` добавить поле `withAuth` в объект опций. В `render.tsx` `RenderOptions` получает `withAuth?: boolean`, а `htmlDocument` в трёх местах — `modules: [...(options.withAuth ? [\`${basePath}/assets/auth.js\`] : []), ...]`.

Порядок важен: `auth.js` должен грузиться до inline-скриптов, чтобы `window.CourseSync` существовал к моменту первого вызова. `htmlDocument` уже ставит `modules` перед `scripts`.

- [ ] **Step 7: Проверить сборку в обоих режимах**

Run:

```bash
npm run site:build
test -f out/assets/auth.js && echo "неожиданно собрался без переменных" || echo "без переменных — как раньше"

SUPABASE_URL=https://example.supabase.co SUPABASE_ANON_KEY=test npm run site:build
test -f out/assets/auth.js && test -f out/auth/index.html && echo "с переменными — собрался"
grep -c 'assets/auth.js' out/lesson/*/index.html | head -3
```

Expected: первая сборка без `auth.js`, вторая — с `auth.js`, `auth/index.html` и ссылкой на модуль в страницах уроков.

- [ ] **Step 8: Прогнать проверки и закоммитить**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

```bash
git add package.json package-lock.json src/site-auth/auth.ts src/lib/site/render.tsx src/lib/site/client.ts scripts/build-site.mts
git commit -m "feat(site): sign in with github and mirror progress to supabase"
```

---

### Task 7: Подтягивание облака на открытии страницы

**Files:**
- Modify: `src/site-auth/auth.ts`
- Modify: `src/lib/site/client.ts` (`PROGRESS_SCRIPT`, `LESSON_INDEX_SCRIPT`, `EXERCISE_SCRIPT`)

**Interfaces:**
- Consumes: `window.CourseSync`, событие `course-sync-ready` из задачи 6.
- Produces: события `course-sync-progress` (без деталей) и `course-sync-file` с `detail: { slug: string; fileName: string; backup: boolean }`.

Миграция из задачи 6 уже пишет слитый прогресс в `localStorage`, но только при первом входе. Здесь то же слияние выполняется при каждом открытии страницы — иначе прогресс, сделанный на втором устройстве, не доедет до первого.

- [ ] **Step 1: Слить облако с локальным при каждом входе**

Modify `src/site-auth/auth.ts`: вынести общий код и вызывать слияние всегда, а не только при первом входе. Заменить блок из шага 5 задачи 6 на:

```ts
/** Слияние без флага: то же самое, что миграция, но выполняется каждый раз. */
async function syncNow(user: string): Promise<{ steps: number; files: number; backups: number }> {
  const cloud = await pullCloud();
  const local = readLocalProgress(snapshot(), new Date().toISOString());
  const plan = planMigration(local, cloud);

  if (plan.steps.length > 0) {
    await client.from("step_progress").upsert(
      plan.steps.map((row) => ({
        user_id: user,
        lesson_slug: row.lessonSlug,
        step_id: row.stepId,
        state: row.state,
        updated_at: row.updatedAt,
      })),
    );
  }
  if (plan.files.length > 0) {
    await client.from("exercise_files").upsert(
      plan.files.map((row) => ({
        user_id: user,
        slug: row.slug,
        file_name: row.fileName,
        content: row.content,
        updated_at: row.updatedAt ?? new Date().toISOString(),
      })),
    );
  }

  write(plan.writes);
  window.dispatchEvent(new CustomEvent("course-sync-progress"));
  for (const [key, value] of Object.entries(plan.writes)) {
    if (!key.startsWith(EXERCISE_KEY_PREFIX)) continue;
    if (key.endsWith(":updatedAt")) continue;
    const backup = key.endsWith(":local-backup");
    const clean = backup ? key.slice(0, -":local-backup".length) : key;
    const rest = clean.slice(EXERCISE_KEY_PREFIX.length);
    const separator = rest.indexOf(":");
    window.dispatchEvent(
      new CustomEvent("course-sync-file", {
        detail: {
          slug: separator === -1 ? rest : rest.slice(0, separator),
          fileName: separator === -1 ? "exercise.py" : rest.slice(separator + 1),
          backup,
          content: backup ? undefined : value,
        },
      }),
    );
  }
  return { steps: plan.steps.length, files: plan.files.length, backups: plan.backups };
}

void ready.then(async () => {
  paintButton();
  if (!session) {
    window.dispatchEvent(new CustomEvent("course-sync-ready", { detail: { user: null } }));
    return;
  }
  const user = session.user.id;
  const fresh = !alreadyMigrated(user);
  let detail: Record<string, unknown> = { user, migrated: false };
  try {
    const result = await syncNow(user);
    if (fresh) {
      try {
        localStorage.setItem(SYNCED_KEY_PREFIX + user, new Date().toISOString());
      } catch {
        // Без флага слияние просто повторится: оно идемпотентно.
      }
      detail = { user, migrated: true, ...result };
    }
  } catch (error) {
    detail = { user, migrated: false, error: String(error) };
  }
  window.dispatchEvent(new CustomEvent("course-sync-ready", { detail }));
});
```

Функции `migrateOnce` больше нет — её тело переехало в `syncNow`, а флаг выставляется снаружи. Удалить `migrateOnce` целиком.

- [ ] **Step 2: Перерисовывать прогресс по событию**

Modify `src/lib/site/client.ts`: в `PROGRESS_SCRIPT`, сразу после `paint(readProgress(data.slug));`:

```js
// Прогресс мог приехать из облака уже после отрисовки: слияние асинхронно.
window.addEventListener("course-sync-progress", function () {
  paint(readProgress(data.slug));
});
```

В `LESSON_INDEX_SCRIPT` тело скрипта обернуть в функцию `paint()` и вызвать её сразу, а затем добавить:

```js
window.addEventListener("course-sync-progress", paint);
```

- [ ] **Step 3: Показывать приехавший код и плашку про копию**

Modify `src/lib/site/client.ts`, в конец `EXERCISE_SCRIPT` (перед закрывающим `})();`):

```js
  // Код приехал с другого устройства. Молча подменять текст под пальцами
  // нельзя, поэтому подменяется только нетронутый редактор; тронутый получает
  // плашку и остаётся как есть.
  var dirty = false;
  area.addEventListener("input", function () { dirty = true; });

  var notice = document.querySelector("[data-sync-notice]");
  function say(text) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
  }

  window.addEventListener("course-sync-file", function (event) {
    var detail = event.detail || {};
    if (detail.slug !== data.slug || detail.fileName !== activeFile) return;
    if (detail.backup) {
      say("На этом устройстве был другой код. Победил код из аккаунта, а local-копия сохранена в хранилище браузера.");
      return;
    }
    if (dirty) {
      say("Код из аккаунта новее того, что открыт здесь. Обнови страницу, чтобы забрать его.");
      return;
    }
    full = detail.content;
    var parts = split(full, data.fn);
    activeParts = parts;
    setCode(parts ? parts.code : full);
    say("Код подтянут из аккаунта.");
  });
```

- [ ] **Step 4: Прогнать проверки**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. Существующие тесты страниц не знают ни про какие события и работают как раньше: без `window.CourseSync` ни одна новая ветка не выполняется.

- [ ] **Step 5: Commit**

```bash
git add src/site-auth/auth.ts src/lib/site/client.ts
git commit -m "feat(site): pull cloud progress into the page on every visit"
```

---

### Task 8: Ручная проверка и публикация

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-24-supabase-user-progress-design.md` (только если проверка вскроет расхождение с задуманным)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: опубликованный сайт с входом и раздел README про аккаунты.

- [ ] **Step 1: Собрать и поднять сайт локально**

Run:

```bash
SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  BASE_PATH="" npm run site:build
npx serve out -l 4173
```

Открыть `http://localhost:4173/`.

- [ ] **Step 2: Пройти чеклист вручную**

Каждый пункт — отдельная проверка, все обязательны:

1. Аноним: пройти два шага урока, счётчик растёт, во вкладке Network нет запросов к `supabase.co`.
2. Нажать «Войти через GitHub», согласиться. Возврат на `/auth/`, строка про влитый прогресс с ненулевыми числами, затем возврат на тот шаг, откуда уходили.
3. Table Editor в Supabase: в `step_progress` строки с прочитанными шагами, `user_id` — свой.
4. Открыть тот же адрес во втором браузере, войти тем же аккаунтом: прочитанные шаги отмечены галочками.
5. Во втором браузере пройти ещё шаг, в первом обновить страницу урока — шаг отмечен.
6. Шаг с практикой: написать код, дождаться сохранения, увидеть строку в `exercise_files`.
7. Прогнать тесты до зелёного: шаг получает `passed` в `step_progress`, в `run_results` появляется строка с цифрами.
8. Прогнать тесты до красного на уже сданном шаге: `passed` в базе не меняется.
9. Проверка расхождения кода: во втором браузере до входа написать другой код в то же упражнение, затем войти — появляется плашка про сохранённую копию, а в `localStorage` есть ключ с суффиксом `:local-backup`.
10. Выйти из аккаунта: прогресс на странице остаётся на месте, запросы к `supabase.co` прекращаются.
11. Повторить шаг 4 из задачи 1 (проверка RLS через curl) — на живой базе с данными, а не на пустой.

- [ ] **Step 3: Дописать README**

Добавить в README.md раздел после «Как это работает»:

```markdown
## Аккаунты на опубликованном сайте

Опубликованная статика умеет вход через GitHub и хранит прогресс в Supabase:
прочитанные шаги, состояние практики и текст упражнений. Без входа всё
работает как раньше — прогресс живёт в `localStorage` этого браузера.

При первом входе прогресс из браузера вливается в аккаунт, а не заменяется
облачным: прочитанные шаги объединяются, `passed` не сбрасывается в `failed`,
а разошедшийся код упражнения уступает облачному с сохранением копии в ключе
`:local-backup`.

Сборка с входом требует `SUPABASE_URL` и `SUPABASE_ANON_KEY` в окружении. Без
них `npm run site:build` собирает сайт без кнопки входа. Схема базы —
`supabase/schema.sql`, накатывается руками через SQL Editor.
```

- [ ] **Step 4: Опубликовать**

Run:

```bash
SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" npm run site:publish
```

Expected: пуш в `gh-pages` без ошибок; через минуту на `https://odiukov.github.io/ai-course-lab/` есть кнопка входа.

- [ ] **Step 5: Повторить чеклист на опубликованном сайте**

Пункты 2, 4 и 9 из шага 2 — на живом адресе. Именно там впервые проверяется, что Redirect URLs в Supabase настроены верно: локальный адрес и адрес Pages — разные записи.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: describe accounts and cloud progress on the published site"
```

---

## Замечания для исполнителя

- Задачи 2–5 не требуют ни проекта Supabase, ни сети: их можно делать до того, как задача 1 закончена.
- Тесты страниц (`client.test.ts`) исполняют скрипты в happy-dom без `window.CourseSync`. Любая новая ветка в клиентском коде обязана проверять его существование перед вызовом — иначе падают уже существующие тесты, и это ровно то поведение, которое нужно: без бандла страница работает как раньше.
- В задаче 7 функция `migrateOnce` из задачи 6 удаляется целиком. Это не потеря: её тело переехало в `syncNow`, а разница между первым входом и последующими свелась к одному флагу.
