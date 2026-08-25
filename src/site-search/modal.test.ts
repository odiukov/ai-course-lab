import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSearch } from "./modal";
import type { SearchHit, SearchProvider } from "./search-provider";

const hits: SearchHit[] = [
  {
    title: "Векторы и матрицы",
    lesson: "Линейная алгебра",
    url: "/course/vectors/",
    excerpt: "Умножение <mark>векторов</mark> на число",
  },
  {
    title: "Градиентный спуск",
    lesson: "Оптимизация",
    url: "/course/gradient-descent/",
    excerpt: "Как <mark>градиент</mark> меняет параметры",
  },
];

class FakeSearchProvider implements SearchProvider {
  readonly queries: string[] = [];

  constructor(private readonly respond: (query: string) => Promise<SearchHit[]>) {}

  search(query: string): Promise<SearchHit[]> {
    this.queries.push(query);
    return this.respond(query);
  }
}

let window: Window;
let cleanups: Array<() => void>;

beforeEach(() => {
  window = new Window();
  window.document.body.innerHTML = '<button data-search-trigger>Найти</button>';
  cleanups = [];
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  window.close();
});

function pick<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = window.document.querySelector(selector);
  if (!element) throw new Error(`Не найден элемент ${selector}`);
  return element as unknown as T;
}

function press(
  key: string,
  options: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): void {
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key, ...options }));
}

function pressInput(key: string): boolean {
  const event = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  pick<HTMLInputElement>("[data-search-input]").dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

function pressOn(element: HTMLElement, key: string, options: { shiftKey?: boolean } = {}): void {
  element.dispatchEvent(
    new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options }) as unknown as Event,
  );
}

function type(value: string): void {
  const input = pick<HTMLInputElement>("[data-search-input]");
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
}

async function eventually(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 500;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError;
}

function install(provider: SearchProvider, debounceMs = 1): { factoryCalls: () => number } {
  let factoryCalls = 0;
  cleanups.push(
    installSearch(
      () => {
        factoryCalls += 1;
        return provider;
      },
      window.document as unknown as Document,
      debounceMs,
    ),
  );
  return { factoryCalls: () => factoryCalls };
}

describe("поисковая модалка", () => {
  it("открывается по Cmd+K и Ctrl+K, лениво создавая провайдер один раз", () => {
    const provider = new FakeSearchProvider(async () => hits);
    const { factoryCalls } = install(provider);

    expect(factoryCalls()).toBe(0);
    press("k", { metaKey: true });

    expect(factoryCalls()).toBe(1);
    expect(pick("[data-search-modal]").hidden).toBe(false);
    expect(window.document.activeElement).toBe(pick("[data-search-input]"));

    pick<HTMLButtonElement>("[data-search-close]").click();
    press("k", { ctrlKey: true });

    expect(factoryCalls()).toBe(1);
    expect(pick("[data-search-modal]").hidden).toBe(false);
  });

  it("не открывается по Alt+Cmd+K", () => {
    const provider = new FakeSearchProvider(async () => hits);
    const { factoryCalls } = install(provider);

    press("k", { altKey: true, metaKey: true });

    expect(factoryCalls()).toBe(0);
    expect(window.document.querySelector("[data-search-modal]")).toBeNull();
  });

  it("открывается кликом по триггеру", () => {
    install(new FakeSearchProvider(async () => hits));

    pick<HTMLButtonElement>("[data-search-trigger]").click();

    const modal = pick("[data-search-modal]");
    expect(modal.classList.contains("search-modal")).toBe(true);
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(pick(".search-dialog").querySelector(".search-heading > h2")?.textContent).toBe(
      "Поиск по курсу",
    );
    expect(pick(".search-heading > .search-close").hasAttribute("data-search-close")).toBe(true);
    expect(pick("[data-search-input]").classList.contains("search-input")).toBe(true);
    expect(pick("[data-search-input]").getAttribute("role")).toBe("combobox");
    expect(pick("[data-search-input]").getAttribute("aria-controls")).toBe(
      pick("[data-search-results]").id,
    );
    expect(pick("[data-search-status]").classList.contains("search-status")).toBe(true);
    expect(pick("[data-search-status]").getAttribute("aria-live")).toBe("polite");
    expect(pick("[data-search-results]").classList.contains("search-results")).toBe(true);
    expect(pick("[data-search-results]").getAttribute("role")).toBe("listbox");
  });

  it("дебаунсит ввод и рендерит заголовок, урок и безопасный фрагмент", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider, 5);
    pick<HTMLButtonElement>("[data-search-trigger]").click();

    type("  вектор  ");

    expect(provider.queries).toEqual([]);
    expect(pick("[data-search-status]").textContent).toBe("Ищу…");

    await eventually(() => {
      expect(provider.queries).toEqual(["вектор"]);
      expect(pick("[data-search-results]").textContent).toContain("Векторы и матрицы");
      expect(pick("[data-search-results]").textContent).toContain("Линейная алгебра");
      expect(pick("[data-search-results]").innerHTML).toContain("<mark>векторов</mark>");
      expect(pick("[data-search-result]").classList.contains("search-result")).toBe(true);
      expect(pick(".search-result-title").textContent).toBe("Векторы и матрицы");
      expect(pick(".search-result-lesson").textContent).toBe("Линейная алгебра");
      expect(pick(".search-result-excerpt").innerHTML).toContain("<mark>векторов</mark>");
    });
  });

  it("отменяет предыдущий debounce и ищет только последний быстрый запрос", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider, 10);
    pick<HTMLButtonElement>("[data-search-trigger]").click();

    type("первый");
    type("второй");

    await eventually(() => expect(provider.queries).toEqual(["второй"]));
  });

  it("выбирает второй результат стрелкой вниз и открывает его по Enter", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("градиент");
    await eventually(() => expect(window.document.querySelectorAll("[data-search-result]")).toHaveLength(2));

    const results = [...window.document.querySelectorAll("[data-search-result]")] as unknown as HTMLAnchorElement[];
    let destination = "";
    results[1].addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      destination = results[1].getAttribute("href") ?? "";
    });

    expect(pick<HTMLInputElement>("[data-search-input]").getAttribute("aria-activedescendant")).toBe(
      results[0].id,
    );
    expect(pressInput("ArrowDown")).toBe(true);
    expect(pressInput("Enter")).toBe(true);

    expect(results[1].classList.contains("is-active")).toBe(true);
    expect(results[1].getAttribute("aria-current")).toBe("true");
    expect(pick<HTMLInputElement>("[data-search-input]").getAttribute("aria-activedescendant")).toBe(
      results[1].id,
    );
    expect(destination).toBe("/course/gradient-descent/");

    destination = "";
    const closeButton = pick<HTMLButtonElement>("[data-search-close]");
    closeButton.focus();
    pressOn(closeButton, "Enter");

    expect(destination).toBe("");

    type("");
    expect(pick<HTMLInputElement>("[data-search-input]").getAttribute("aria-activedescendant")).toBeNull();
    expect(pick("[data-search-results]").children).toHaveLength(0);
  });

  it("ловит Tab внутри модалки и не передаёт фокус фоновому триггеру", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    const trigger = pick<HTMLButtonElement>("[data-search-trigger]");
    trigger.click();
    type("вектор");
    await eventually(() => expect(window.document.querySelectorAll("[data-search-result]")).toHaveLength(2));

    const closeButton = pick<HTMLButtonElement>("[data-search-close]");
    const input = pick<HTMLInputElement>("[data-search-input]");
    const results = [...window.document.querySelectorAll("[data-search-result]")] as unknown as HTMLAnchorElement[];

    closeButton.focus();
    pressOn(closeButton, "Tab");
    expect(window.document.activeElement).toBe(input);

    results[1].focus();
    pressOn(results[1], "Tab");
    expect(window.document.activeElement).toBe(closeButton);
    expect(window.document.activeElement).not.toBe(trigger);

    closeButton.focus();
    pressOn(closeButton, "Tab", { shiftKey: true });
    expect(window.document.activeElement).toBe(results[1]);
  });

  it("оставляет обычный клик по результату нативным", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("вектор");
    await eventually(() => expect(window.document.querySelectorAll("[data-search-result]")).toHaveLength(2));

    const result = pick<HTMLAnchorElement>("[data-search-result]");
    let destination = "";
    let wasPrevented = true;
    result.addEventListener("click", (event: MouseEvent) => {
      wasPrevented = event.defaultPrevented;
      event.preventDefault();
      destination = result.getAttribute("href") ?? "";
    });
    result.click();

    expect(destination).toBe("/course/vectors/");
    expect(wasPrevented).toBe(false);
  });

  it("закрывается по Escape и возвращает фокус на кликнутый триггер", () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    const trigger = pick<HTMLButtonElement>("[data-search-trigger]");

    trigger.click();

    press("Escape");

    expect(pick("[data-search-modal]").hidden).toBe(true);
    expect(window.document.body.classList.contains("has-search-modal")).toBe(false);
    expect(window.document.activeElement).toBe(trigger);
  });

  it("закрытие во время debounce очищает состояние перед повторным открытием", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    vi.useFakeTimers();
    try {
      install(provider, 20);
      pick<HTMLButtonElement>("[data-search-trigger]").click();
      type("ожидающий");
      pick<HTMLButtonElement>("[data-search-close]").click();
      pick<HTMLButtonElement>("[data-search-trigger]").click();

      expect(pick<HTMLInputElement>("[data-search-input]").value).toBe("");
      expect(pick("[data-search-status]").textContent).toBe("Введите запрос");
      expect(pick("[data-search-results]").children).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(21);

      expect(provider.queries).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("закрытие инвалидирует ожидающий ответ перед повторным открытием", async () => {
    let resolvePending: (value: SearchHit[]) => void = () => undefined;
    const provider = new FakeSearchProvider(
      () =>
        new Promise<SearchHit[]>((resolve) => {
          resolvePending = resolve;
        }),
    );
    install(provider);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("ожидающий");
    await eventually(() => expect(provider.queries).toEqual(["ожидающий"]));

    pick<HTMLButtonElement>("[data-search-close]").click();
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    resolvePending(hits);
    await Promise.resolve();
    await Promise.resolve();

    expect(pick<HTMLInputElement>("[data-search-input]").value).toBe("");
    expect(pick("[data-search-status]").textContent).toBe("Введите запрос");
    expect(pick("[data-search-results]").children).toHaveLength(0);
  });

  it("закрывается кликом по фону", () => {
    install(new FakeSearchProvider(async () => hits));
    pick<HTMLButtonElement>("[data-search-trigger]").click();

    pick("[data-search-modal]").click();

    expect(pick("[data-search-modal]").hidden).toBe(true);
  });

  it("вставляет заголовок и урок результата как текст", async () => {
    const hostileHit: SearchHit = {
      ...hits[0],
      title: '<img src=x onerror="alert(1)">Заголовок',
      lesson: '<img src=x onerror="alert(1)">Урок',
    };
    install(new FakeSearchProvider(async () => [hostileHit]));
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("текст");

    await eventually(() => expect(window.document.querySelector("[data-search-result]")).not.toBeNull());

    expect(pick(".search-result-title").textContent).toBe(hostileHit.title);
    expect(pick(".search-result-lesson").textContent).toBe(hostileHit.lesson);
    expect(window.document.querySelector(".search-result-title img")).toBeNull();
    expect(window.document.querySelector(".search-result-lesson img")).toBeNull();
  });

  it("переиспользует одну модалку и провайдер для всех триггеров", () => {
    window.document.body.insertAdjacentHTML("beforeend", '<button data-search-trigger>Ещё найти</button>');
    const provider = new FakeSearchProvider(async () => hits);
    const { factoryCalls } = install(provider);
    const triggers = [...window.document.querySelectorAll("[data-search-trigger]")] as unknown as HTMLButtonElement[];

    triggers[0].click();
    pick<HTMLButtonElement>("[data-search-close]").click();
    triggers[1].click();

    expect(factoryCalls()).toBe(1);
    expect(window.document.querySelectorAll("[data-search-modal]")).toHaveLength(1);
  });

  it("показывает точное сообщение при недоступном поиске", async () => {
    install(new FakeSearchProvider(async () => Promise.reject(new Error("offline"))));
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("вектор");

    await eventually(() => expect(pick("[data-search-status]").textContent).toBe("Поиск сейчас недоступен"));
    expect(pick("[data-search-results]").children).toHaveLength(0);
  });

  it("показывает точное сообщение при пустом результате", async () => {
    install(new FakeSearchProvider(async () => []));
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("несуществующее");

    await eventually(() => expect(pick("[data-search-status]").textContent).toBe("Ничего не найдено"));
  });

  it("не перерисовывает устаревший ответ после нового запроса", async () => {
    const resolvers: Array<(value: SearchHit[]) => void> = [];
    const provider = new FakeSearchProvider(
      () =>
        new Promise<SearchHit[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    install(provider);
    pick<HTMLButtonElement>("[data-search-trigger]").click();

    type("первый");
    await eventually(() => expect(provider.queries).toEqual(["первый"]));
    type("второй");
    await eventually(() => expect(provider.queries).toEqual(["первый", "второй"]));

    resolvers[1]([hits[1]]);
    await eventually(() => expect(pick("[data-search-results]").textContent).toContain("Градиентный спуск"));
    resolvers[0]([hits[0]]);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(pick("[data-search-results]").textContent).toContain("Градиентный спуск");
    expect(pick("[data-search-results]").textContent).not.toContain("Векторы и матрицы");
  });

  it("cleanup отменяет таймер, инвалидирует ответ и снимает обработчики", async () => {
    let resolvePending: (value: SearchHit[]) => void = () => undefined;
    const provider = new FakeSearchProvider(
      () =>
        new Promise<SearchHit[]>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const cleanup = installSearch(() => provider, window.document as unknown as Document, 10);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("ожидающий");
    await eventually(() => expect(provider.queries).toEqual(["ожидающий"]));

    cleanup();
    resolvePending(hits);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(window.document.querySelector("[data-search-modal]")).toBeNull();
    expect(window.document.body.classList.contains("has-search-modal")).toBe(false);

    const debounceProvider = new FakeSearchProvider(async () => hits);
    const cancelDebounce = installSearch(
      () => debounceProvider,
      window.document as unknown as Document,
      10,
    );
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("не должен искаться");
    cancelDebounce();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(debounceProvider.queries).toEqual([]);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    press("k", { metaKey: true });

    expect(window.document.querySelector("[data-search-modal]")).toBeNull();
  });
});
