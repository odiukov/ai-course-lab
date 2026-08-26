import { describe, expect, it } from "vitest";
import { loadReviewCards } from "./cards-source";
import type { ReviewStorage } from "../lib/review/storage";
import type { SiteCard } from "../lib/site/cards-payload";
import { PROGRESS_KEY_PREFIX } from "../lib/site/storage-keys";

const MANIFEST = [
  { slug: "01-alpha", title: "Альфа", count: 1 },
  { slug: "02-beta", title: "Бета", count: 1 },
];

function card(id: string): SiteCard {
  return {
    kind: "choice",
    question: `Вопрос ${id}`,
    explanation: "Разбор.",
    options: ["Верно", "Неверно"],
    correct: 0,
    id,
    fingerprint: "abcd1234",
  };
}

function storageWith(entries: Record<string, string>): ReviewStorage {
  return {
    getItem: (key) => entries[key] ?? null,
    setItem: () => {},
  };
}

/** Прогресс чтения одного шага — этого хватает, чтобы урок попал в загрузку. */
function readProgress(...slugs: string[]): ReviewStorage {
  const entries: Record<string, string> = {};
  for (const slug of slugs) entries[PROGRESS_KEY_PREFIX + slug] = JSON.stringify(["s-1"]);
  return storageWith(entries);
}

/** Подставная загрузка: отдаёт заготовленный ответ и записывает запрошенные адреса. */
function fetcher(responses: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    fetchJson: async (url: string): Promise<unknown> => {
      asked.push(url);
      if (!(url in responses)) throw new Error(`нет ответа на ${url}`);
      const response = responses[url];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe("loadReviewCards", () => {
  it("отдаёт карточки уроков с прогрессом чтения", async () => {
    const { fetchJson } = fetcher({
      "/base/cards/index.json": MANIFEST,
      "/base/cards/01-alpha.json": [card("c-1")],
    });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: readProgress("01-alpha"),
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(Object.keys(result.cards)).toEqual(["01-alpha"]);
    expect(result.cards["01-alpha"][0].id).toBe("c-1");
  });

  it("не ходит за уроками без прогресса чтения", async () => {
    const { asked, fetchJson } = fetcher({
      "/base/cards/index.json": MANIFEST,
      "/base/cards/02-beta.json": [card("c-2")],
    });

    await loadReviewCards({
      basePath: "/base",
      fetchJson,
      // У «01-alpha» ключ прогресса есть, но список прочитанных шагов пуст:
      // урок открыли и закрыли, повторять нечего.
      storage: storageWith({
        [PROGRESS_KEY_PREFIX + "01-alpha"]: "[]",
        [PROGRESS_KEY_PREFIX + "02-beta"]: JSON.stringify(["s-1"]),
      }),
    });

    expect(asked).toEqual(["/base/cards/index.json", "/base/cards/02-beta.json"]);
  });

  it("отказ сети на манифесте — это отказ, а не пустая очередь", async () => {
    const { fetchJson } = fetcher({
      "/base/cards/index.json": new Error("network"),
    });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: readProgress("01-alpha"),
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).not.toBe("");
  });

  it("отказ сети на файле урока — тоже отказ", async () => {
    const { fetchJson } = fetcher({
      "/base/cards/index.json": MANIFEST,
      "/base/cards/01-alpha.json": new Error("network"),
    });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: readProgress("01-alpha"),
    });

    expect(result.status).toBe("failed");
  });

  it("отсутствующий файл урока не отказ, а урок мимо очереди", async () => {
    const { fetchJson } = fetcher({
      "/base/cards/index.json": MANIFEST,
      // Карточки урока ещё не сгенерированы: сервер отдаёт 404, загрузка — null.
      "/base/cards/01-alpha.json": null,
      "/base/cards/02-beta.json": [card("c-2")],
    });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: readProgress("01-alpha", "02-beta"),
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(Object.keys(result.cards)).toEqual(["02-beta"]);
  });

  it("нечитаемый манифест — отказ, а не пустая очередь", async () => {
    const { fetchJson } = fetcher({ "/base/cards/index.json": { slugs: [] } });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: readProgress("01-alpha"),
    });

    expect(result.status).toBe("failed");
  });

  it("отказ хранилища не роняет загрузку", async () => {
    const { asked, fetchJson } = fetcher({ "/base/cards/index.json": MANIFEST });

    const result = await loadReviewCards({
      basePath: "/base",
      fetchJson,
      storage: {
        getItem: () => {
          throw new Error("приватное окно");
        },
        setItem: () => {},
      },
    });

    // Прогресса не видно — значит, повторять нечего; это не отказ загрузки.
    expect(result.status).toBe("loaded");
    expect(asked).toEqual(["/base/cards/index.json"]);
  });
});
