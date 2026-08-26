import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RENDERERS } from "./index";
import type { SiteCard } from "../../lib/site/cards-payload";

let window: Window;

beforeEach(() => {
  window = new Window();
});

function host(): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.appendChild(element);
  return element as unknown as HTMLElement;
}

const CHOICE: SiteCard = {
  kind: "choice",
  question: "Что делает каузальная маска?",
  explanation: "Обнуляет вес позиций правее текущей.",
  options: ["Запрещает смотреть вправо", "Ускоряет softmax", "Экономит память"],
  correct: 0,
  id: "c-1",
  fingerprint: "abcd1234",
};

describe("choice", () => {
  it("показывает все варианты", () => {
    const element = host();
    RENDERERS.choice.mount(element, CHOICE, () => {});
    expect(element.querySelectorAll("button[data-option]")).toHaveLength(3);
  });

  it("верный выбор даёт good", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.choice.mount(element, CHOICE, onAnswer);
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("неверный выбор даёт again", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.choice.mount(element, CHOICE, onAnswer);
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[1].click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });
});

describe("numeric", () => {
  const card: SiteCard = {
    kind: "numeric",
    question: "Чему равен loss?",
    explanation: "ln(1024) ≈ 6.93.",
    answer: 6.93,
    tolerance: 0.05,
    id: "n-1",
    fingerprint: "abcd1234",
  };

  it("принимает ответ внутри допуска", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "6.95";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("отвергает ответ вне допуска", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "7.5";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });

  it("принимает запятую как десятичный разделитель", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "6,93";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("cloze", () => {
  const card: SiteCard = {
    kind: "cloze",
    question: "Допиши строку",
    explanation: "Сумма по последней оси.",
    template: "probs = exp / exp.sum(___)",
    answer: "axis=-1",
    accept: ["axis = -1"],
    id: "z-1",
    fingerprint: "abcd1234",
  };

  it("принимает точный ответ", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.cloze.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "axis=-1";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("принимает написание из accept и не придирается к регистру и пробелам", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.cloze.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "  AXIS = -1 ";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("order", () => {
  const card: SiteCard = {
    kind: "order",
    question: "Расставь шаги",
    explanation: "Справа налево.",
    items: ["Первый", "Второй", "Третий"],
    id: "o-1",
    fingerprint: "abcd1234",
  };

  it("показывает элементы перемешанными, но все", () => {
    const element = host();
    RENDERERS.order.mount(element, card, () => {});
    const labels = [...element.querySelectorAll("[data-item]")].map((node) => node.textContent);
    expect(labels.sort()).toEqual(["Второй", "Первый", "Третий"]);
  });

  it("правильный порядок даёт good", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.order.mount(element, card, onAnswer);
    for (const label of card.items) {
      [...element.querySelectorAll<HTMLButtonElement>("[data-item]")]
        .find((node) => node.textContent === label)!
        .click();
    }
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("open", () => {
  const card: SiteCard = {
    kind: "open",
    question: "Объясни своими словами",
    explanation: "Разбор.",
    reference: "Эталонный ответ целиком.",
    id: "p-1",
    fingerprint: "abcd1234",
  };

  it("показывает эталон только после запроса", () => {
    const element = host();
    RENDERERS.open.mount(element, card, () => {});
    expect(element.textContent).not.toContain("Эталонный ответ целиком.");
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    expect(element.textContent).toContain("Эталонный ответ целиком.");
  });

  it("даёт ровно три кнопки самооценки", () => {
    const element = host();
    RENDERERS.open.mount(element, card, () => {});
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    expect(element.querySelectorAll("button[data-self]")).toHaveLength(3);
  });

  it("самооценка приходит без признака правильности", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.open.mount(element, card, onAnswer);
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    element.querySelector<HTMLButtonElement>('button[data-self="hard"]')!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "hard", correct: null });
  });
});
