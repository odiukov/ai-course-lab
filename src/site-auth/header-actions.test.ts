import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { appendAuthButton } from "./header-actions";

describe("слот действий в шапке", () => {
  it("помещает кнопку входа в слот действий, а не рядом с содержимым шапки", () => {
    const window = new Window();
    window.document.body.innerHTML = `<header>
<a class="back">← к урокам</a>
<span data-header-actions><button data-search-trigger>Поиск</button></span>
</header>`;
    const button = window.document.createElement("button");

    appendAuthButton(window.document as unknown as Document, button as unknown as HTMLButtonElement);

    const header = window.document.querySelector("header")!;
    const actions = window.document.querySelector("[data-header-actions]")!;
    expect(actions.lastElementChild).toBe(button);
    expect(header.lastElementChild).toBe(actions);
    window.close();
  });

  it("сохраняет совместимость со шапкой без слота", () => {
    const window = new Window();
    window.document.body.innerHTML = "<header><h1>AI Lab</h1></header>";
    const button = window.document.createElement("button");

    appendAuthButton(window.document as unknown as Document, button as unknown as HTMLButtonElement);

    expect(window.document.querySelector("header")!.lastElementChild).toBe(button);
    window.close();
  });
});
