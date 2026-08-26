import { describe, expect, it } from "vitest";
import { buildManifest, toSiteCards } from "./cards-payload";
import type { Card } from "../cards/card";

const CARD: Card = {
  kind: "numeric",
  concept: "стартовый loss равен логарифму размера словаря",
  question: "В словаре 1024 токена. Чему примерно равен loss?",
  explanation: "ln(1024) ≈ 6.93.",
  answer: 6.93,
  tolerance: 0.05,
  id: "046-quiz-1",
  fingerprint: "abcd1234",
};

describe("toSiteCards", () => {
  it("выбрасывает concept: он нужен аудиту, а не читателю", () => {
    const [card] = toSiteCards([CARD]);
    expect("concept" in card).toBe(false);
  });

  it("сохраняет id и отпечаток — по ним живёт график", () => {
    const [card] = toSiteCards([CARD]);
    expect(card.id).toBe("046-quiz-1");
    expect(card.fingerprint).toBe("abcd1234");
  });

  it("сохраняет поля вида карточки", () => {
    const [card] = toSiteCards([CARD]);
    expect(card).toMatchObject({ kind: "numeric", answer: 6.93, tolerance: 0.05 });
  });
});

describe("buildManifest", () => {
  it("оставляет только уроки, у которых есть карточки", () => {
    const manifest = buildManifest([
      { slug: "01-alpha", title: "Альфа", cards: 3 },
      { slug: "02-beta", title: "Бета", cards: 0 },
    ]);
    expect(manifest).toEqual([{ slug: "01-alpha", title: "Альфа", count: 3 }]);
  });
});
