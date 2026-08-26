import type { Grade } from "../../lib/review/scheduler";
import type { SiteCard } from "../../lib/site/cards-payload";

export interface AnswerResult {
  grade: Grade;
  /** `null` у самооценки: там правильности как факта не существует. */
  correct: boolean | null;
}

/**
 * Отрисовщик одного вида карточки.
 *
 * Знает только карточку и колбэк. Ни про очередь, ни про планировщик, ни про
 * хранилище ему знать нечего — новый вид добавляется новым модулем и одной
 * строкой в таблице RENDERERS.
 */
export interface CardRenderer {
  mount(host: HTMLElement, card: SiteCard, onAnswer: (result: AnswerResult) => void): void;
}
