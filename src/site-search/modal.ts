import type { SearchHit, SearchProvider } from "./search-provider";

let modalId = 0;

interface SearchModal {
  open(restoreFocus: HTMLElement | null): void;
  handleDocumentKey(event: KeyboardEvent): void;
  destroy(): void;
}

/** Устанавливает поиск страницы и возвращает функцию снятия всех обработчиков. */
export function installSearch(
  providerFactory: () => SearchProvider,
  document: Document = window.document,
  debounceMs = 250,
): () => void {
  // Composition root устанавливает поиск только один раз на документ.
  const triggers = [...document.querySelectorAll<HTMLButtonElement>("[data-search-trigger]")];
  let modal: SearchModal | undefined;

  const open = (restoreFocus: HTMLElement | null) => {
    modal ??= createSearchModal(providerFactory(), document, debounceMs);
    modal.open(restoreFocus);
  };

  const onTriggerClick = (event: MouseEvent) => open(event.currentTarget as HTMLElement);
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() === "k" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault();
      open(document.activeElement as HTMLElement | null);
      return;
    }

    modal?.handleDocumentKey(event);
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
  const instanceId = ++modalId;
  const headingId = `search-modal-title-${instanceId}`;
  const resultsId = `search-modal-results-${instanceId}`;
  const overlay = document.createElement("div");
  overlay.className = "search-modal";
  overlay.dataset.searchModal = "";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", headingId);

  const dialog = document.createElement("div");
  dialog.className = "search-dialog";
  const headingWrapper = document.createElement("div");
  headingWrapper.className = "search-heading";
  const heading = document.createElement("h2");
  heading.id = headingId;
  heading.textContent = "Поиск по курсу";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "search-close";
  closeButton.dataset.searchClose = "";
  closeButton.setAttribute("aria-label", "Закрыть поиск");
  closeButton.textContent = "Закрыть";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.dataset.searchInput = "";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Поиск по курсу");
  input.setAttribute("aria-controls", resultsId);
  input.setAttribute("aria-expanded", "false");
  const status = document.createElement("p");
  status.className = "search-status";
  status.dataset.searchStatus = "";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Введите запрос";
  const results = document.createElement("ol");
  results.className = "search-results";
  results.dataset.searchResults = "";
  results.id = resultsId;
  results.setAttribute("role", "listbox");

  headingWrapper.append(heading, closeButton);
  dialog.append(headingWrapper, input, status, results);
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
    input.removeAttribute("aria-activedescendant");
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
      anchor.setAttribute("aria-selected", String(active));
    });
    input.setAttribute("aria-activedescendant", anchors[activeIndex].id);
  };

  const renderHits = (hits: SearchHit[]) => {
    clearResults();
    for (const [index, hit] of hits.entries()) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.className = "search-result";
      anchor.dataset.searchResult = "";
      anchor.id = `${resultsId}-option-${index}`;
      anchor.setAttribute("href", hit.url);
      anchor.setAttribute("role", "option");

      const title = document.createElement("span");
      title.className = "search-result-title";
      title.textContent = hit.title;
      const lesson = document.createElement("span");
      lesson.className = "search-result-lesson";
      lesson.textContent = hit.lesson;
      const excerpt = document.createElement("span");
      excerpt.className = "search-result-excerpt";
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
    input.value = "";
    clearResults();
    status.textContent = "Введите запрос";
    input.setAttribute("aria-expanded", "false");
    overlay.hidden = true;
    document.body.classList.remove("has-search-modal");
    if (previousFocus?.isConnected) previousFocus.focus();
  };

  const open = (restoreFocus: HTMLElement | null) => {
    if (isOpen) return;
    previousFocus = restoreFocus;
    isOpen = true;
    overlay.hidden = false;
    document.body.classList.add("has-search-modal");
    input.setAttribute("aria-expanded", "true");
    input.focus();
  };

  const onBackdropClick = (event: MouseEvent) => {
    if (event.target === overlay) close();
  };
  const onCloseClick = () => close();
  const focusableElements = () =>
    [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !isOpen) return;
    const elements = focusableElements();
    if (elements.length === 0) return;
    const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? currentIndex <= 0
        ? elements.at(-1)
        : elements[currentIndex - 1]
      : currentIndex === -1 || currentIndex === elements.length - 1
        ? elements[0]
        : elements[currentIndex + 1];
    event.preventDefault();
    next?.focus();
  };
  const onInputKeyDown = (event: KeyboardEvent) => {
    if (!isOpen) return;
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
      event.preventDefault();
      const active = results.querySelectorAll<HTMLAnchorElement>("[data-search-result]")[activeIndex];
      active?.click();
    }
  };

  overlay.addEventListener("click", onBackdropClick);
  closeButton.addEventListener("click", onCloseClick);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onInputKeyDown);

  return {
    open,
    handleDocumentKey(event) {
      if (!isOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapTab(event);
    },
    destroy() {
      close();
      overlay.removeEventListener("click", onBackdropClick);
      closeButton.removeEventListener("click", onCloseClick);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onInputKeyDown);
      overlay.remove();
    },
  };
}
