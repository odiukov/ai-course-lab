import { REVIEW_KEY_PREFIX } from "../site/storage-keys";
import type { CardState } from "./scheduler";

/**
 * Состояние карточки на диске.
 *
 * К полям планировщика добавлены два: отпечаток карточки, по которому видно,
 * что вопрос переписали, и время правки — оно нужно слиянию с облаком, чтобы
 * знать, чья запись свежее.
 */
export interface StoredState extends CardState {
  fingerprint: string;
  updatedAt: string;
}

/** То, что нужно от localStorage. Интерфейс ради тестов без браузера. */
export interface ReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Всякое обращение обёрнуто в try целиком.
 *
 * В приватном окне Safari запись бросает, и без обёртки на этом падал бы весь
 * скрипт страницы, включая навигацию. Пустой объект означает «графика нет»,
 * и страница просто предложит новые карточки.
 */
export function readLessonStates(
  storage: ReviewStorage,
  slug: string,
): Record<string, StoredState> {
  try {
    const raw = storage.getItem(REVIEW_KEY_PREFIX + slug);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, StoredState>) : {};
  } catch {
    return {};
  }
}

export function writeCardState(
  storage: ReviewStorage,
  slug: string,
  cardId: string,
  state: StoredState,
): void {
  try {
    const states = readLessonStates(storage, slug);
    states[cardId] = state;
    storage.setItem(REVIEW_KEY_PREFIX + slug, JSON.stringify(states));
  } catch {
    // Отказ записи означает подход, который не сохранится. Ронять страницу
    // из-за этого нельзя: читать урок человек может и без графика.
  }
}
