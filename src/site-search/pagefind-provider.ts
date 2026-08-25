import type { SearchHit, SearchProvider } from "./search-provider";

const RESULT_LIMIT = 20;

// Этот файл — единственное место приложения, которое знает формы результатов Pagefind.
interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: Record<string, unknown>;
}

interface PagefindResultRef {
  data(): Promise<PagefindResultData>;
}

interface PagefindApi {
  init(): Promise<void> | void;
  search(query: string): Promise<{ results: PagefindResultRef[] }>;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function resultUrl(basePath: string, url: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("#")) {
    return url;
  }

  const path = url.startsWith("/") ? url : `/${url}`;
  if (!basePath || path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }

  return `${basePath}${path}`;
}

// Нелитеральный dynamic import остаётся до выполнения в браузере: esbuild не ищет
// сгенерированный Pagefind-модуль во время сборки приложения.
function importPagefind(url: string): Promise<PagefindApi> {
  return import(url) as Promise<PagefindApi>;
}

export class PagefindProvider implements SearchProvider {
  private readonly pagefind: Promise<PagefindApi>;

  constructor(private readonly basePath: string) {
    this.pagefind = importPagefind(`${basePath}/pagefind/pagefind.js`).then(async (pagefind) => {
      await pagefind.init();
      return pagefind;
    });
  }

  async search(query: string): Promise<SearchHit[]> {
    const pagefind = await this.pagefind;
    const { results } = await pagefind.search(query);
    const data = await Promise.all(results.slice(0, RESULT_LIMIT).map((result) => result.data()));

    return data.map((result) => ({
      title: text(result.meta.title, "Без названия"),
      lesson: text(result.meta.lesson, "Урок не указан"),
      url: resultUrl(this.basePath, result.url),
      excerpt: result.excerpt,
    }));
  }
}
