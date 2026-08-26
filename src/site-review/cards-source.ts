import type { ReviewStorage } from "../lib/review/storage";
import type { CardsManifestEntry, SiteCard } from "../lib/site/cards-payload";
import { PROGRESS_KEY_PREFIX } from "../lib/site/storage-keys";
import { RENDERERS } from "./renderers";

/**
 * Загрузка одного JSON сайта.
 *
 * `null` означает «файла нет» — для карточек урока это не отказ, а лишь
 * «ещё не сгенерированы». Всякая другая беда бросает: отказ сети нельзя
 * молча превратить в пустой ответ, иначе очередь окажется пустой по причине,
 * о которой никто не узнает.
 *
 * Настоящий `fetch` подставляет `index.ts`; в тестах это подставной объект.
 */
export type FetchJson = (url: string) => Promise<unknown>;

export interface CardsSourceDeps {
  basePath: string;
  fetchJson: FetchJson;
  /** Отсюда читается прогресс чтения — обычно `localStorage`. */
  storage: ReviewStorage;
}

/**
 * Итог загрузки, размеченный намеренно.
 *
 * Пустая очередь и несостоявшаяся загрузка выглядят на странице одинаково —
 * ни одной карточки, — но означают противоположное: первое «всё повторено»,
 * второе «мы не знаем». Без разметки страница показала бы человеку «всё
 * повторено», и он ушёл бы, решив, что работы нет.
 */
export type CardsLoad =
  | { status: "loaded"; cards: Record<string, SiteCard[]> }
  | { status: "failed"; message: string };

const LOAD_FAILED_MESSAGE =
  "Карточки не загрузились. Это не значит, что повторять нечего: проверь соединение и обнови страницу.";

/**
 * Отказ хранилища — свой случай со своим текстом.
 *
 * Отдавать здесь «повторять нечего» нельзя: прогресс чтения не прочитан, и
 * страница не знает ни одного урока, а не знает, что уроки пройдены. Про
 * соединение говорить тоже незачем — сеть тут ни при чём.
 */
const STORAGE_FAILED_MESSAGE =
  "Не удалось прочитать прогресс чтения: браузер не даёт доступ к хранилищу — например, в приватном окне. Без него страница не знает, какие уроки повторять.";

function isManifest(value: unknown): value is CardsManifestEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { slug?: unknown }).slug === "string",
    )
  );
}

/**
 * Урок участвует в подходе, только если в нём что-то прочитано.
 *
 * Предлагать повторять непройденное бессмысленно, а заодно это и есть тот
 * фильтр, который держит число запросов на уровне «сколько уроков прочитано»,
 * а не «сколько уроков в курсе».
 *
 * Отказ `getItem` наружу не ловится намеренно — его разбирает `readLessons`.
 * Битый JSON в ключе одного урока — другое дело: это испорченная запись, а не
 * отказ хранилища, и урок просто проходит мимо очереди.
 */
function hasReadingProgress(storage: ReviewStorage, slug: string): boolean {
  const raw = storage.getItem(PROGRESS_KEY_PREFIX + slug);
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Прочитанные уроки — или `null`, если хранилище не отвечает.
 *
 * Отказ чтения нельзя выдать за пустой список: пустой список означает «ничего
 * не пройдено», а отказ — «мы не знаем». Первое приводит читателя к «На
 * сегодня всё.», то есть к неправде ровно там, где размеченный итог загрузки и
 * существует, чтобы неправды не было.
 */
function readLessons(storage: ReviewStorage, slugs: string[]): string[] | null {
  try {
    return slugs.filter((slug) => hasReadingProgress(storage, slug));
  } catch {
    return null;
  }
}

/**
 * Карточка, которую страница умеет нарисовать.
 *
 * Файл урока приходит из сети и до сих пор просто приводился к типу. Карточка с
 * незнакомым `kind` доезжала после этого до `RENDERERS[card.kind].mount` и
 * падала на `undefined.mount` — уже после того, как хост подхода очищен, то
 * есть читатель оставался перед пустым экраном. Незнакомую карточку выбрасываем
 * молча: то же положение, что и урок без файла карточек, а спека называет его
 * не ошибкой.
 *
 * `id` и `fingerprint` проверяются здесь же: по ним живёт ключ графика, и
 * карточка без них писала бы состояние под ключом «undefined».
 */
function isDrawable(value: unknown): value is SiteCard {
  if (typeof value !== "object" || value === null) return false;
  const card = value as { kind?: unknown; id?: unknown; fingerprint?: unknown };
  return (
    typeof card.kind === "string" &&
    Object.prototype.hasOwnProperty.call(RENDERERS, card.kind) &&
    typeof card.id === "string" &&
    typeof card.fingerprint === "string"
  );
}

/**
 * Карточки уроков, которые человек читал.
 *
 * Сначала манифест — без него неизвестно, у каких уроков карточки вообще есть,
 * и страница либо тянула бы все файлы курса, либо собирала бы сотни 404.
 * Дальше по файлу на урок, и только на прочитанный.
 */
export async function loadReviewCards(deps: CardsSourceDeps): Promise<CardsLoad> {
  let manifest: unknown;
  try {
    manifest = await deps.fetchJson(`${deps.basePath}/cards/index.json`);
  } catch {
    return { status: "failed", message: LOAD_FAILED_MESSAGE };
  }
  // Манифеста нет или он не читается — не то же, что урок без карточек:
  // страница в этом случае не знает ничего и не должна делать вид, что знает.
  if (!isManifest(manifest)) return { status: "failed", message: LOAD_FAILED_MESSAGE };

  const slugs = readLessons(
    deps.storage,
    manifest.map((entry) => entry.slug),
  );
  if (!slugs) return { status: "failed", message: STORAGE_FAILED_MESSAGE };

  // Файлы уроков запрашиваются разом, а не по очереди: у человека с двадцатью
  // прочитанными уроками последовательные запросы складываются в секунду
  // ожидания перед первой карточкой.
  let payloads: unknown[];
  try {
    payloads = await Promise.all(
      slugs.map((slug) => deps.fetchJson(`${deps.basePath}/cards/${slug}.json`)),
    );
  } catch {
    return { status: "failed", message: LOAD_FAILED_MESSAGE };
  }

  const cards: Record<string, SiteCard[]> = {};
  slugs.forEach((slug, index) => {
    // Не массив — файла нет (404 приходит как `null`): карточки урока ещё не
    // сгенерированы, и урок просто не участвует в очереди.
    const payload = payloads[index];
    if (!Array.isArray(payload)) return;
    const drawable = payload.filter(isDrawable);
    if (drawable.length) cards[slug] = drawable;
  });

  return { status: "loaded", cards };
}
