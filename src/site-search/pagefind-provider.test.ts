import { describe, expect, it } from "vitest";
import { PagefindProvider } from "./pagefind-provider";

describe("PagefindProvider", () => {
  it("не показывает неточные совпадения для составного идентификатора", async () => {
    const fuzzyResult = {
      url: "/lesson/fuzzy/",
      excerpt: "Локальное влияние параметров на <mark>zzz</mark>",
      meta: { lesson: "← Урок", title: "Нечёткое совпадение" },
    };
    const pagefind = {
      init: () => undefined,
      search: async (query: string) => ({
        results: query.startsWith('"') ? [] : [{ data: async () => fuzzyResult }],
      }),
    };
    const provider = Object.create(PagefindProvider.prototype) as PagefindProvider;
    Object.assign(provider, { basePath: "/ai-course-lab", pagefind: Promise.resolve(pagefind) });

    await expect(provider.search("zzzz-course-no-result-20260825")).resolves.toEqual([]);
  });
});
