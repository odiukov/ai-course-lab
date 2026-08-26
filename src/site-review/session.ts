import { buildQueue, stateKey, type QueueCard } from "../lib/review/queue";
import { newCardState, schedule, type CardState } from "../lib/review/scheduler";
import type { StoredState } from "../lib/review/storage";
import type { SiteCard } from "../lib/site/cards-payload";
import { RENDERERS, type AnswerResult } from "./renderers";

export interface SessionDeps {
  /** Загруженные карточки: ключ — slug урока. */
  cards: Record<string, SiteCard[]>;
  /** График по ключу `<slug>/<card-id>`. */
  states: Record<string, StoredState>;
  today: string;
  onGraded(lessonSlug: string, card: SiteCard, state: StoredState): void;
}

/**
 * Один подход.
 *
 * Ни сети, ни хранилища, ни глобального `document`: карточки, график и запись
 * приходят аргументами, узлы берутся у `host.ownerDocument`. Поэтому подход
 * проверяется тестом на happy-dom без поднятого браузера, и поэтому же
 * отладочный сдвиг дня — это просто повторный вызов с другой датой.
 */
export function runSession(host: HTMLElement, deps: SessionDeps): void {
  const doc = host.ownerDocument;

  const cardByKey = new Map<string, { lessonSlug: string; card: SiteCard }>();
  const refs: QueueCard[] = [];
  const states: Record<string, CardState> = {};

  for (const [lessonSlug, cards] of Object.entries(deps.cards)) {
    for (const card of cards) {
      const key = stateKey({ lessonSlug, cardId: card.id });
      cardByKey.set(key, { lessonSlug, card });
      refs.push({ lessonSlug, cardId: card.id });

      // Разошедшийся отпечаток — переписанный вопрос. Состояние в хранилище
      // остаётся, но в очереди карточка идёт как новая: унаследовать интервал
      // в три месяца на вопрос, которого человек не видел, значит не показать
      // его никогда.
      const stored = deps.states[key];
      if (stored && stored.fingerprint === card.fingerprint) states[key] = stored;
    }
  }

  const queue = buildQueue(refs, states, deps.today);
  let position = 0;

  function grade(lessonSlug: string, card: SiteCard, result: AnswerResult): void {
    const key = stateKey({ lessonSlug, cardId: card.id });
    const next = schedule(states[key] ?? newCardState(deps.today), result.grade, deps.today);
    // Дата подхода и время правки — разные вещи: срок считается от `today`,
    // пришедшего аргументом, а `updatedAt` — это настенные часы, по ним
    // слияние с облаком решает, чья запись свежее.
    const stored: StoredState = {
      ...next,
      fingerprint: card.fingerprint,
      updatedAt: new Date().toISOString(),
    };
    states[key] = stored;
    deps.onGraded(lessonSlug, card, stored);
  }

  function showCurrent(): void {
    // Хост очищается перед каждой карточкой: отрисовщики только дописывают
    // узлы, и без этого вторая карточка встала бы под первой.
    host.replaceChildren();

    if (position >= queue.length) {
      host.appendChild(renderFinished(doc, queue.length));
      return;
    }

    const ref = queue[position];
    const entry = cardByKey.get(stateKey(ref));
    // Очередь собрана из тех же ссылок, что и карта, так что промах
    // невозможен. Молчаливый выход оставил бы читателя перед пустой
    // страницей без единой строки в консоли.
    if (!entry) throw new Error(`карточки ${stateKey(ref)} нет среди загруженных`);

    const panel = doc.createElement("article");
    panel.className = "review-card";
    host.appendChild(panel);

    const last = position === queue.length - 1;
    RENDERERS[entry.card.kind].mount(panel, entry.card, (result) => {
      grade(entry.lessonSlug, entry.card, result);
      host.appendChild(renderReview(doc, entry.card, result, last, advance));
    });
  }

  function advance(): void {
    position += 1;
    showCurrent();
  }

  showCurrent();
}

/**
 * Разбор и переход к следующей карточке.
 *
 * Вопрос остаётся на экране: разбор без вопроса читается как ответ на реплику,
 * которой не слышно, — особенно у карточки с пропуском.
 */
function renderReview(
  doc: Document,
  card: SiteCard,
  result: AnswerResult,
  last: boolean,
  onNext: () => void,
): HTMLElement {
  const panel = doc.createElement("div");
  panel.className = "review-answer";

  // У самооценки правильности как факта не существует, и вердикт там был бы
  // выдумкой: `correct === null` означает «машина не знает».
  if (result.correct !== null) {
    const verdict = doc.createElement("p");
    verdict.className = "review-verdict";
    verdict.textContent = result.correct ? "Верно" : "Неверно";
    panel.appendChild(verdict);
  }

  const explanation = doc.createElement("p");
  explanation.className = "review-explanation";
  explanation.textContent = card.explanation;
  panel.appendChild(explanation);

  const next = doc.createElement("button");
  next.type = "button";
  next.className = "nav-button is-primary";
  next.dataset.next = "";
  next.textContent = last ? "Закончить" : "Дальше";
  next.addEventListener("click", onNext);
  panel.appendChild(next);

  return panel;
}

function renderFinished(doc: Document, count: number): HTMLElement {
  const message = doc.createElement("p");
  message.className = "review-done";
  // Про потолок подхода здесь не сказано ничего: страница не знает, сколько
  // карточек он отсёк, и обещать «всё» после сорока было бы неправдой.
  message.textContent =
    count === 0 ? "На сегодня всё." : `Подход закончен. Отвечено карточек: ${count}.`;
  return message;
}
