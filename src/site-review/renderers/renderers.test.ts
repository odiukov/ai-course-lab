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

/** Клик по элементам порядка в заданной последовательности подписей. */
function pick(element: HTMLElement, labels: readonly string[]): void {
  for (const label of labels) {
    [...element.querySelectorAll<HTMLButtonElement>("[data-item]")]
      .find((node) => node.textContent === label)!
      .click();
  }
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

  // Второй ответ по той же карточке — это второй вызов планировщика и вторая
  // панель разбора поверх первой. Держится он на том, что отрисовщик гасит
  // кнопки до колбэка, и до сих пор это было проверено только чтением.
  it("оценивает карточку один раз, сколько ни щёлкай", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.choice.mount(element, CHOICE, onAnswer);
    const buttons = element.querySelectorAll<HTMLButtonElement>("button[data-option]");
    buttons[0].click();
    buttons[1].click();
    buttons[0].click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
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

  // Number("") — это 0, а не NaN: без отдельной проверки пустоты молчание
  // попадало бы в допуск на всякой карточке с ответом около нуля.
  it("пустой ответ не засчитывается даже на карточке с ответом ноль", () => {
    const zero: SiteCard = { ...card, answer: 0, id: "n-0" };
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, zero, onAnswer);
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });

  it("оценивает карточку один раз, сколько ни щёлкай", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "6.93";
    const submit = element.querySelector<HTMLButtonElement>("button[data-submit]")!;
    submit.click();
    submit.click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
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

  // Схема требует от шаблона только наличие "___", так что пропусков может
  // быть и два. Хвост после второго терять нельзя: читателя оценивают по
  // строке кода, и строка без закрывающей скобки — уже другая строка.
  it("не теряет хвост шаблона с двумя пропусками", () => {
    const two: SiteCard = {
      ...card,
      template: "probs = exp.sum(___, keepdims=___)",
      id: "z-2",
    };
    const element = host();
    RENDERERS.cloze.mount(element, two, () => {});
    expect(element.textContent).toContain(", keepdims=___)");
  });

  it("оценивает карточку один раз, сколько ни щёлкай", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.cloze.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "axis=-1";
    const submit = element.querySelector<HTMLButtonElement>("button[data-submit]")!;
    submit.click();
    submit.click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
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
    pick(element, card.items);
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("неправильный порядок даёт again", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.order.mount(element, card, onAnswer);
    pick(element, [...card.items].reverse());
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });

  it("показывает выбранное списком по ходу дела", () => {
    const element = host();
    RENDERERS.order.mount(element, card, () => {});
    pick(element, ["Второй"]);
    const picks = [...element.querySelectorAll("[data-pick]")].map((node) => node.textContent);
    expect(picks).toEqual(["Второй"]);
  });

  it("сброс возвращает кнопки и очищает выбранное", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.order.mount(element, card, onAnswer);
    pick(element, ["Третий", "Первый"]);

    element.querySelector<HTMLButtonElement>("button[data-reset]")!.click();

    expect(element.querySelectorAll("[data-pick]")).toHaveLength(0);
    const disabled = [...element.querySelectorAll<HTMLButtonElement>("[data-item]")].filter(
      (node) => node.disabled,
    );
    expect(disabled).toHaveLength(0);

    // После сброса можно ответить верно: ошибка на втором шаге из шести не
    // должна означать гарантированный провал в графике.
    pick(element, card.items);
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("оценивает карточку один раз, сколько ни щёлкай", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.order.mount(element, card, onAnswer);
    pick(element, card.items);
    pick(element, [card.items[0], card.items[1]]);
    expect(onAnswer).toHaveBeenCalledTimes(1);
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

  // Значения остаются английскими — на них держатся data-self и gradeSelf, —
  // а подписи русские: сайт русскоязычный, и именно здесь человек выбирает.
  it("подписывает кнопки самооценки по-русски", () => {
    const element = host();
    RENDERERS.open.mount(element, card, () => {});
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    const labels = [...element.querySelectorAll("button[data-self]")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["не вспомнил", "с трудом", "легко"]);
  });

  it("оценивает карточку один раз, сколько ни щёлкай", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.open.mount(element, card, onAnswer);
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    element.querySelector<HTMLButtonElement>('button[data-self="hard"]')!.click();
    element.querySelector<HTMLButtonElement>('button[data-self="easy"]')!.click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
