import type { SearchHit, SearchProvider } from "./search-provider";

interface SearchModal {
  open(): void;
  close(): void;
  handleKey(event: KeyboardEvent): void;
  destroy(): void;
}

/** Устанавливает поиск страницы и возвращает функцию снятия всех обработчиков. */
export function installSearch(
  providerFactory: () => SearchProvider,
  document: Document = window.document,
  debounceMs = 250,
): () => void {
  const triggers = [...document.querySelectorAll<HTMLButtonElement>("[data-search-trigger]")];
  let modal: SearchModal | undefined;

  const open = () => {
    modal ??= createSearchModal(providerFactory(), document, debounceMs);
    modal.open();
  };

  const onTriggerClick = () => open();
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() === "k" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault();
      open();
      return;
    }

    modal?.handleKey(event);
  };

  for (const trigger of triggers) trigger.addEventListener("click", onTriggerClick);
  document.addEventListener("keydown", onDocumentKeyDown);

  return () => {
    for (const trigger of triggers) trigger.removeEventListener("click", onTriggerClick);
    document.removeEventListener("keydown", onDocumentKeyDown);
    modal?.destroy();
    modal = undefined;
  };
}

function createSearchModal(
  provider: SearchProvider,
  document: Document,
  debounceMs: number,
): SearchModal {
  const overlay = document.createElement("div");
  overlay.dataset.searchModal = "";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "search-modal-title");

  const dialog = document.createElement("div");
  dialog.className = "search-dialog";
  const heading = document.createElement("h2");
  heading.id = "search-modal-title";
  heading.textContent = "Поиск по курсу";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.dataset.searchClose = "";
  closeButton.setAttribute("aria-label", "Закрыть поиск");
  closeButton.textContent = "Закрыть";
  const input = document.createElement("input");
  input.type = "search";
  input.dataset.searchInput = "";
  input.setAttribute("aria-label", "Поиск по курсу");
  const status = document.createElement("p");
  status.dataset.searchStatus = "";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Введите запрос";
  const results = document.createElement("ol");
  results.dataset.searchResults = "";

  dialog.append(heading, closeButton, input, status, results);
  overlay.append(dialog);
  document.body.append(overlay);

  let previousFocus: HTMLElement | null = null;
  let activeIndex = -1;
  let isOpen = false;
  let requestVersion = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearResults = () => {
    results.replaceChildren();
    activeIndex = -1;
  };

  const cancelPendingSearch = () => {
    requestVersion += 1;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };

  const setActiveResult = (index: number) => {
    const anchors = [...results.querySelectorAll<HTMLAnchorElement>("[data-search-result]")];
    if (anchors.length === 0) return;

    activeIndex = Math.max(0, Math.min(index, anchors.length - 1));
    anchors.forEach((anchor, anchorIndex) => {
      const active = anchorIndex === activeIndex;
      anchor.classList.toggle("is-active", active);
      if (active) anchor.setAttribute("aria-current", "true");
      else anchor.removeAttribute("aria-current");
    });
  };

  const renderHits = (hits: SearchHit[]) => {
    clearResults();
    for (const hit of hits) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.dataset.searchResult = "";
      anchor.setAttribute("href", hit.url);

      const title = document.createElement("strong");
      title.textContent = hit.title;
      const lesson = document.createElement("span");
      lesson.textContent = hit.lesson;
      const excerpt = document.createElement("p");
      // Контракт SearchProvider гарантирует, что excerpt уже безопасно экранирован.
      excerpt.innerHTML = hit.excerpt;

      anchor.append(title, lesson, excerpt);
      item.append(anchor);
      results.append(item);
    }
    if (hits.length > 0) setActiveResult(0);
  };

  const search = (query: string) => {
    const version = requestVersion;
    void Promise.resolve()
      .then(() => provider.search(query))
      .then((hits) => {
        if (!isOpen || version !== requestVersion) return;
        renderHits(hits);
        status.textContent = hits.length === 0 ? "Ничего не найдено" : `Найдено: ${hits.length}`;
      })
      .catch(() => {
        if (!isOpen || version !== requestVersion) return;
        clearResults();
        status.textContent = "Поиск сейчас недоступен";
      });
  };

  const onInput = () => {
    const query = input.value.trim();
    cancelPendingSearch();
    clearResults();

    if (query === "") {
      status.textContent = "Введите запрос";
      return;
    }

    status.textContent = "Ищу…";
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      search(query);
    }, debounceMs);
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    cancelPendingSearch();
    overlay.hidden = true;
    document.body.classList.remove("has-search-modal");
    previousFocus?.focus();
  };

  const open = () => {
    if (isOpen) return;
    previousFocus = document.activeElement as HTMLElement | null;
    isOpen = true;
    overlay.hidden = false;
    document.body.classList.add("has-search-modal");
    input.focus();
  };

  const onBackdropClick = (event: MouseEvent) => {
    if (event.target === overlay) close();
  };
  const onCloseClick = () => close();

  overlay.addEventListener("click", onBackdropClick);
  closeButton.addEventListener("click", onCloseClick);
  input.addEventListener("input", onInput);

  return {
    open,
    close,
    handleKey(event) {
      if (!isOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResult(activeIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResult(activeIndex - 1);
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        const active = results.querySelectorAll<HTMLAnchorElement>("[data-search-result]")[activeIndex];
        active?.click();
      }
    },
    destroy() {
      close();
      overlay.removeEventListener("click", onBackdropClick);
      closeButton.removeEventListener("click", onCloseClick);
      input.removeEventListener("input", onInput);
      overlay.remove();
    },
  };
}
