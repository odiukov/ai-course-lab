import type { Card } from "../cards/card";

/**
 * Omit по объединению нужен распределяющий: обычный `Omit` над
 * размеченным объединением оставляет только общие поля и выбрасывает
 * `options`, `answer`, `template`, `items` и `reference` вместе с `concept`.
 */
type OmitConcept<T> = T extends unknown ? Omit<T, "concept"> : never;

/**
 * Карточка в том виде, в каком она едет в браузер.
 *
 * Отличие от файла ровно одно: выброшен `concept`. Он существует для контроля
 * разнообразия при генерации и для аудита, читателю не показывается никогда, а
 * на тридцати тысячах карточек это заметный вес на проводе.
 */
export type SiteCard = OmitConcept<Card>;

export interface CardsManifestEntry {
  slug: string;
  title: string;
  count: number;
}

export function toSiteCards(cards: Card[]): SiteCard[] {
  // Приведение через остаток, а не перечисление полей: новый вид карточки
  // иначе молча уезжал бы в браузер без своих полей.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return cards.map(({ concept: _concept, ...rest }) => rest);
}

/**
 * Манифест — список уроков, у которых карточки есть.
 *
 * Без него страница не знает, куда ходить, и либо тянет все 474 файла, либо
 * пробует их по одному и собирает сотни 404. С манифестом она делает один
 * запрос и дальше берёт только нужные уроки.
 */
export function buildManifest(
  entries: { slug: string; title: string; cards: number }[],
): CardsManifestEntry[] {
  return entries
    .filter((entry) => entry.cards > 0)
    .map((entry) => ({ slug: entry.slug, title: entry.title, count: entry.cards }));
}
