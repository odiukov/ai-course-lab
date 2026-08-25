import { installSearch } from "./modal";
import { PagefindProvider } from "./pagefind-provider";

const basePath = document.body.getAttribute("data-base") ?? "";
const shortcut = document.querySelector<HTMLElement>("[data-search-shortcut]");
if (shortcut && !/Mac|iPhone|iPad|iPod/.test(navigator.platform)) shortcut.textContent = "Ctrl K";

// Фабрика нужна потому, что конструктор провайдера начинает импорт; он нужен только при первом открытии.
installSearch(() => new PagefindProvider(basePath));
