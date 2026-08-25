import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function press(key: string, options: { ctrlKey?: boolean; metaKey?: boolean } = {}): void {
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key, ...options }));
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

  it("открывается кликом по триггеру", () => {
    install(new FakeSearchProvider(async () => hits));

    pick<HTMLButtonElement>("[data-search-trigger]").click();

    expect(pick("[data-search-modal]").getAttribute("role")).toBe("dialog");
    expect(pick("[data-search-modal]").getAttribute("aria-modal")).toBe("true");
    expect(pick("[data-search-status]").getAttribute("aria-live")).toBe("polite");
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
    });
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

    press("ArrowDown");
    press("Enter");

    expect(results[1].classList.contains("is-active")).toBe(true);
    expect(results[1].getAttribute("aria-current")).toBe("true");
    expect(destination).toBe("/course/gradient-descent/");
  });

  it("оставляет обычный клик по результату нативным", async () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    type("вектор");
    await eventually(() => expect(window.document.querySelectorAll("[data-search-result]")).toHaveLength(2));

    const result = pick<HTMLAnchorElement>("[data-search-result]");
    let destination = "";
    result.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      destination = result.getAttribute("href") ?? "";
    });
    result.click();

    expect(destination).toBe("/course/vectors/");
  });

  it("закрывается по Escape и возвращает фокус триггеру", () => {
    const provider = new FakeSearchProvider(async () => hits);
    install(provider);
    const trigger = pick<HTMLButtonElement>("[data-search-trigger]");
    trigger.focus();
    trigger.click();

    press("Escape");

    expect(pick("[data-search-modal]").hidden).toBe(true);
    expect(window.document.body.classList.contains("has-search-modal")).toBe(false);
    expect(window.document.activeElement).toBe(trigger);
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

  it("cleanup снимает обработчики и удаляет модалку", () => {
    const provider = new FakeSearchProvider(async () => hits);
    const cleanup = installSearch(() => provider, window.document as unknown as Document, 1);
    pick<HTMLButtonElement>("[data-search-trigger]").click();

    cleanup();
    pick<HTMLButtonElement>("[data-search-trigger]").click();
    press("k", { metaKey: true });

    expect(window.document.querySelector("[data-search-modal]")).toBeNull();
  });
});
