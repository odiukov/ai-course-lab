import { stateKey } from "../lib/review/queue";
import { addDays } from "../lib/review/scheduler";
import { readLessonStates, writeCardState, type StoredState } from "../lib/review/storage";
import type { SiteCard } from "../lib/site/cards-payload";
import { loadReviewCards } from "./cards-source";
import { runSession } from "./session";

/**
 * Страница повторений: единственное место режима, которое знает про браузер.
 *
 * Логика живёт в `session.ts` и `cards-source.ts` и проверяется тестами без
 * браузера; здесь только глобальные объекты — `document`, `localStorage`,
 * `fetch`, адрес страницы.
 */

const basePath = document.body.getAttribute("data-base") ?? "";
const host = document.querySelector<HTMLElement>("[data-review]");
const debugPanel = document.querySelector<HTMLElement>("[data-review-debug]");
const shiftField = document.querySelector<HTMLInputElement>("[data-review-shift]");
const shiftApply = document.querySelector<HTMLButtonElement>("[data-review-shift-apply]");
const shiftNote = document.querySelector<HTMLElement>("[data-review-shift-note]");

/**
 * Сегодня по местным часам, а не по UTC.
 *
 * `toISOString` от полуночи до трёх утра по Киеву вернул бы вчерашнюю дату, и
 * карточки, готовые сегодня, ждали бы до утра.
 */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** 404 — не отказ: карточек у урока может просто не быть. */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as unknown;
}

/**
 * Мост между раскладкой хранилища и подходом.
 *
 * На диске график лежит по уроку, ключ — голый id карточки; подход работает с
 * одним плоским ключом `<slug>/<card-id>`, потому что очередь идёт по всем
 * урокам сразу.
 */
function collectStates(slugs: string[]): Record<string, StoredState> {
  const states: Record<string, StoredState> = {};
  for (const lessonSlug of slugs) {
    const lesson = readLessonStates(localStorage, lessonSlug);
    for (const [cardId, state] of Object.entries(lesson)) {
      states[stateKey({ lessonSlug, cardId })] = state;
    }
  }
  return states;
}

/**
 * Подход на выбранный день.
 *
 * `shift` — отладочный сдвиг: он подставляет другую дату в чистые функции и
 * ничего не записывает. Срок, посчитанный от выдуманного дня, испортил бы
 * настоящий график, а без записи худшее, что делает сдвиг, — показывает не тот
 * список.
 */
function startSession(element: HTMLElement, cards: Record<string, SiteCard[]>, shift: number): void {
  runSession(element, {
    cards,
    states: collectStates(Object.keys(cards)),
    today: addDays(today(), shift),
    onGraded:
      shift === 0
        ? (lessonSlug, card, state) => writeCardState(localStorage, lessonSlug, card.id, state)
        : () => {},
  });
}

function installDayShift(element: HTMLElement, cards: Record<string, SiteCard[]>): void {
  if (!debugPanel || !shiftField || !shiftApply) return;
  debugPanel.hidden = false;

  shiftApply.addEventListener("click", () => {
    const shift = Math.max(0, Math.trunc(Number(shiftField.value)) || 0);
    if (shiftNote) {
      shiftNote.textContent =
        shift === 0
          ? `Сегодня, ${today()}. Ответы сохраняются.`
          : `День ${addDays(today(), shift)}. Ответы не сохраняются.`;
    }
    startSession(element, cards, shift);
  });
}

async function main(element: HTMLElement): Promise<void> {
  const loaded = await loadReviewCards({ basePath, fetchJson, storage: localStorage });
  if (loaded.status === "failed") {
    // Ровно тот случай, ради которого итог загрузки размечен: пустая страница
    // без этого сообщения означала бы «всё повторено».
    element.replaceChildren();
    const failure = element.ownerDocument.createElement("p");
    failure.className = "run-status";
    failure.textContent = loaded.message;
    element.appendChild(failure);
    return;
  }

  // Поле сдвига дня показывается только по ?debug=1: читателю курса оно не
  // нужно и только сбивало бы.
  if (new URLSearchParams(window.location.search).get("debug") === "1") {
    installDayShift(element, loaded.cards);
  }

  startSession(element, loaded.cards, 0);
}

if (host) void main(host);
