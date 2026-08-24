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
  LOCAL_BACKUP_SUFFIX,
  PROGRESS_KEY_PREFIX,
  STEP_STATE_KEY_PREFIX,
  SYNCED_KEY_PREFIX,
  UPDATED_AT_SUFFIX,
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
  // Отказ чтения нельзя принимать за пустое облако. Иначе слияние решит, что в
  // аккаунте пусто, а вызывающий выставит флаг «этот браузер уже влит» — и
  // прогресс, набранный здесь, не уедет в аккаунт уже никогда.
  if (steps.error) throw new Error(steps.error.message);
  if (files.error) throw new Error(files.error.message);
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
 * Слияние облака с локальным хранилищем.
 *
 * Выполняется на каждом открытии страницы, а не только при первом входе:
 * иначе прогресс, набранный на втором устройстве, не доехал бы до первого.
 * Слияние идемпотентно, поэтому повтор ничего не стоит и ничего не портит.
 *
 * Локальные ключи не удаляются никогда — выход из аккаунта не должен
 * оставлять человека с пустым курсом.
 *
 * Флаг «этот браузер уже влит» выставляет вызывающий: он относится к первому
 * слиянию, а не к самому слиянию.
 */
async function syncNow(user: string): Promise<{ steps: number; files: number; backups: number }> {
  const cloud = await pullCloud();
  const local = readLocalProgress(snapshot(), new Date().toISOString());
  const plan = planMigration(local, cloud);

  // Запись обратно идёт до отправки, а не после.
  //
  // План посчитан по снимку, снятому строкой выше, и ждать двух обращений к
  // сети с ним на руках нельзя: клик по «Дальше» или зелёный прогон, попавшие
  // в это окно, пишут localStorage сами — и запись целого
  // «course-progress:<урок>» из устаревшего снимка стёрла бы их. Отправка от
  // локальной записи не зависит вовсе.
  write(plan.writes);
  // Страница уже отрисована по тому, что лежало в localStorage до слияния.
  // Событиями ей сообщается, что данные под ней поменялись: сама она об этом
  // узнать не может.
  window.dispatchEvent(new CustomEvent("course-sync-progress"));
  for (const [key, value] of Object.entries(plan.writes)) {
    if (!key.startsWith(EXERCISE_KEY_PREFIX)) continue;
    if (key.endsWith(UPDATED_AT_SUFFIX)) continue;
    const backup = key.endsWith(LOCAL_BACKUP_SUFFIX);
    const clean = backup ? key.slice(0, -LOCAL_BACKUP_SUFFIX.length) : key;
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

/** Отложенные отправки файлов: ключ — «slug:имя файла». */
const fileTimers = new Map<string, number>();

/**
 * Отправка без ожидания.
 *
 * `catch` обязателен: localStorage уже записан, страница живёт дальше, и
 * оборванная сеть не должна ни ронять необработанное отклонение в консоль, ни
 * тем более что-то показывать человеку. Следующее действие и есть повтор.
 */
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
