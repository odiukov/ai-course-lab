interface BookElements {
  root: HTMLElement;
  loading: HTMLElement;
  status: HTMLElement;
  print: HTMLButtonElement;
  fragments: string[];
}

function elements(): BookElements | null {
  const root = document.querySelector<HTMLElement>("[data-book-root]");
  const loading = document.querySelector<HTMLElement>("[data-book-loading]");
  const status = document.querySelector<HTMLElement>("[data-book-status]");
  const print = document.querySelector<HTMLButtonElement>("[data-print-book]");
  const payload = document.querySelector<HTMLScriptElement>("[data-book-fragments]");
  if (!root || !loading || !status || !print || !payload) return null;

  const decoded: unknown = JSON.parse(payload.textContent ?? "[]");
  const fragments = Array.isArray(decoded)
    ? decoded.filter((item): item is string => typeof item === "string")
    : [];
  return { root, loading, status, print, fragments };
}

async function fragment(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить часть книги (${response.status})`);
  // Если CDN уже распаковал ответ по Content-Encoding, fetch отдаёт готовый
  // текст. В обычной раздаче Pages файл .gz приходит как есть.
  if (response.headers.get("content-encoding")?.includes("gzip")) return response.text();
  if (!response.body || typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не умеет распаковать книгу — обнови его до актуальной версии");
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function visualFrames(content: DocumentFragment): Promise<void>[] {
  return [...content.querySelectorAll<HTMLElement>("[data-visual-src]")].map((placeholder) => {
    const frame = document.createElement("iframe");
    frame.className = "book-visual";
    frame.title = placeholder.dataset.visualTitle ?? "Схема";
    frame.setAttribute("sandbox", "allow-scripts");

    const loaded = new Promise<void>((resolve) => {
      const done = () => resolve();
      frame.addEventListener("load", done, { once: true });
      frame.addEventListener("error", done, { once: true });
      window.setTimeout(done, 10_000);
    });
    frame.src = placeholder.dataset.visualSrc ?? "about:blank";
    placeholder.replaceWith(frame);
    return loaded;
  });
}

async function assemble(book: BookElements): Promise<void> {
  const frameLoads: Promise<void>[] = [];
  for (let index = 0; index < book.fragments.length; index += 1) {
    book.status.textContent = `Загружаю часть ${index + 1} из ${book.fragments.length}…`;
    const template = document.createElement("template");
    template.innerHTML = await fragment(book.fragments[index]);
    frameLoads.push(...visualFrames(template.content));
    book.root.append(template.content);
  }

  book.loading.remove();
  book.status.textContent = frameLoads.length > 0 ? "Дожидаюсь загрузки схем…" : "Книга готова";
  await Promise.all(frameLoads);
  book.status.textContent = "Книга готова — выбери «Сохранить как PDF» и отключи «Колонтитулы»";
  book.print.disabled = false;

  if (new URLSearchParams(window.location.search).get("print") === "1") {
    window.setTimeout(() => window.print(), 250);
  }
}

const book = elements();
if (book) {
  book.print.addEventListener("click", () => window.print());
  assemble(book).catch((error: unknown) => {
    book.loading.textContent = error instanceof Error ? error.message : "Не удалось собрать книгу";
    book.status.textContent = "Ошибка сборки";
  });
}
