import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSession } from "./session";
import type { SiteCard } from "../lib/site/cards-payload";

const TODAY = "2026-08-26";

let window: Window;

beforeEach(() => {
  window = new Window();
});

function card(id: string): SiteCard {
  return {
    kind: "choice",
    question: `Вопрос ${id}`,
    explanation: "Разбор.",
    options: ["Верно", "Неверно", "Тоже неверно"],
    correct: 0,
    id,
    fingerprint: "abcd1234",
  };
}

function host(): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.appendChild(element);
  return element as unknown as HTMLElement;
}

describe("runSession", () => {
  it("показывает первую карточку очереди", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    expect(element.textContent).toContain("Вопрос c-1");
  });

  it("после ответа показывает разбор, а не следующую карточку сразу", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1"), card("c-2")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    expect(element.textContent).toContain("Разбор.");
    expect(element.textContent).toContain("Вопрос c-1");
  });

  it("кнопка «дальше» переводит к следующей карточке", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1"), card("c-2")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    element.querySelector<HTMLButtonElement>("button[data-next]")!.click();
    expect(element.textContent).toContain("Вопрос c-2");
  });

  it("сохраняет назначенный срок верного ответа", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();

    expect(onGraded).toHaveBeenCalledTimes(1);
    const [slug, answered, state] = onGraded.mock.calls[0];
    expect(slug).toBe("01-alpha");
    expect(answered.id).toBe("c-1");
    expect(state.intervalDays).toBe(1);
    expect(state.dueOn).toBe("2026-08-27");
    expect(state.fingerprint).toBe("abcd1234");
  });

  it("неверный ответ возвращает карточку на завтра", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[1].click();
    expect(onGraded.mock.calls[0][2]).toMatchObject({ intervalDays: 1, lapses: 1, reps: 0 });
  });

  it("на пустой очереди говорит, что на сегодня всё", () => {
    const element = host();
    runSession(element, { cards: {}, states: {}, today: TODAY, onGraded: () => {} });
    expect(element.textContent).toContain("На сегодня всё");
  });

  it("считает карточку с чужим отпечатком новой", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {
        "01-alpha/c-1": {
          intervalDays: 90,
          ease: 2.5,
          reps: 5,
          lapses: 0,
          dueOn: TODAY,
          fingerprint: "ffff0000",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    // Первый успех новой карточки — один день, а не продолжение девяноста.
    expect(onGraded.mock.calls[0][2].intervalDays).toBe(1);
  });
});
