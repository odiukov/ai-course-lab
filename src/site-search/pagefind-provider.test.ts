import { describe, expect, it } from "vitest";
import { PagefindProvider } from "./pagefind-provider";

describe("PagefindProvider", () => {
  it.each([
    ["softmax", "softmax"],
    ["foo-bar", "foo-bar"],
    ["end-to-end обучение", "end-to-end обучение"],
    ["zzzz-course-no-result-20260825", '"zzzz-course-no-result-20260825"'],
    ["  zzzz-course-no-result-20260825  ", '"zzzz-course-no-result-20260825"'],
  ])("передаёт запрос %s в Pagefind как %s", async (query, expectedQuery) => {
    const pagefindQueries: string[] = [];
    const pagefind = {
      init: () => undefined,
      search: async (pagefindQuery: string) => {
        pagefindQueries.push(pagefindQuery);
        return { results: [] };
      },
    };
    const provider = Object.create(PagefindProvider.prototype) as PagefindProvider;
    Object.assign(provider, { basePath: "/ai-course-lab", pagefind: Promise.resolve(pagefind) });

    await provider.search(query);

    expect(pagefindQueries).toEqual([expectedQuery]);
  });
});
