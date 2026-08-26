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

/**
 * На каждый урок объект
 * `{ "<step-id>": { "state": "read" | "failed" | "passed", "updatedAt": "<ISO>" } }`.
 *
 * Время изменения лежит рядом с состоянием, потому что слиянию с облаком
 * нужно знать, чей `failed` свежее; подставлять время открытия страницы
 * нельзя — оно всегда новее всего облачного.
 */
export const STEP_STATE_KEY_PREFIX = "course-step-state:";

/** Полный текст файла упражнения: `course-exercise:<slug>[:<file>]`. */
export const EXERCISE_KEY_PREFIX = "course-exercise:";

/** Флаг «локальный прогресс уже влит в этот аккаунт»: `course-synced:<user-id>`. */
export const SYNCED_KEY_PREFIX = "course-synced:";

/**
 * График повторений урока: `course-review:<lesson-slug>`, значение — объект
 * `{ "<card-id>": { intervalDays, ease, reps, lapses, dueOn, fingerprint, updatedAt } }`.
 *
 * Отпечаток лежит рядом с состоянием, потому что переписанная по существу
 * карточка не должна унаследовать чужой график: человек получил бы интервал в
 * три месяца на вопрос, которого никогда не видел.
 */
export const REVIEW_KEY_PREFIX = "course-review:";

/** Время последней правки файла упражнения в ISO. */
export const UPDATED_AT_SUFFIX = ":updatedAt";

/** Копия файла, в котором не нашлась функция шага. */
export const RECOVERY_SUFFIX = ":recovery";

/** Копия локального текста, проигравшего облачному при первом слиянии. */
export const LOCAL_BACKUP_SUFFIX = ":local-backup";
