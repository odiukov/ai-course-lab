/**
 * Тонкий слой между бандлом входа и его окружением.
 *
 * Здесь живёт то, что в `src/site-auth/auth.ts` нельзя проверить тестом:
 * модуль входа создаёт клиента Supabase прямо на верхнем уровне, и импортировать
 * его в vitest невозможно. Поэтому чтение хранилища, чтение облака и рассылка
 * событий вынесены сюда — они принимают клиента и хранилище параметрами и
 * проверяются подставными объектами.
 */
import { LOCAL_BACKUP_SUFFIX, UPDATED_AT_SUFFIX } from "../site/storage-keys";
import type { FileRow, StepRow } from "./merge";
import { splitExerciseKey, type StorageSnapshot } from "./migrate";

/** То, что нужно от localStorage: чтение по индексу и по имени. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

interface QueryResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

/** То, что нужно от клиента Supabase: один `select` на таблицу. */
export interface CloudReader {
  from(table: string): { select(columns: string): PromiseLike<QueryResult> };
}

/**
 * Снимок localStorage обычным объектом: разбор живёт в чистом модуле.
 *
 * Обращение обёрнуто в try целиком, включая `length` и `key`: в конфигурации,
 * где хранилище запрещено, бросают и они, а слияние должно тихо ничего не
 * найти, а не показать человеку ошибку.
 */
export function snapshot(storage: StorageLike, prefixes: string[]): StorageSnapshot {
  const result: StorageSnapshot = {};
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      const value = storage.getItem(key);
      if (value !== null) result[key] = value;
    }
  } catch {
    // Если упало середине чтения, неполный снимок хуже пустого: слияние
    // переберёт утраченные ключи как прочитанные, и степи исчезнут,
    // нарушив правило «раз прочитано, никогда не прочитано назад». Сливать
    // нечего, страница живёт дальше.
    return {};
  }
  return result;
}

export async function pullCloud(
  client: CloudReader,
): Promise<{ steps: StepRow[]; files: FileRow[] }> {
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

/** Что страница упражнения узнаёт о приехавшем из облака файле. */
export interface FileSyncEvent {
  slug: string;
  fileName: string;
  /** Приехала не замена текста, а весть об отложенной копии. */
  backup: boolean;
  content?: string;
}

/**
 * События о файлах по записям слияния.
 *
 * Страница уже отрисована по тому, что лежало в localStorage до слияния, и
 * узнать о подмене под собой сама не может. Разбор ключа берётся из
 * `migrate.ts`: правило «есть двоеточие — многофайловое» должно быть одно на
 * обе стороны, иначе события разъедутся с тем, что записано.
 */
export function fileSyncEvents(writes: Record<string, string>): FileSyncEvent[] {
  const events: FileSyncEvent[] = [];
  for (const [key, value] of Object.entries(writes)) {
    if (key.endsWith(UPDATED_AT_SUFFIX)) continue;
    const backup = key.endsWith(LOCAL_BACKUP_SUFFIX);
    const clean = backup ? key.slice(0, -LOCAL_BACKUP_SUFFIX.length) : key;
    const parsed = splitExerciseKey(clean);
    if (!parsed) continue;
    events.push({
      slug: parsed.slug,
      fileName: parsed.fileName,
      backup,
      content: backup ? undefined : value,
    });
  }
  return events;
}
