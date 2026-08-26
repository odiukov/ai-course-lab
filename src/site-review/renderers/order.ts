import { gradeAuto } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

/**
 * Попыток перемешать заново, если перемешанный порядок совпал с исходным.
 *
 * Не `while`: когда все элементы совпадают по значению, ни одна перестановка
 * не отличается от исходной, и условие "совпало" никогда не станет ложным —
 * цикл крутился бы вечно. После потолка попыток принимаем то, что получилось.
 */
const MAX_SHUFFLE_ATTEMPTS = 5;

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Расстановка шагов по порядку.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const order: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "order") throw new Error(`ожидалась карточка order, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    let display = shuffled(card.items);
    for (let attempt = 0; sameOrder(display, card.items) && attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
      display = shuffled(card.items);
    }

    const picked: string[] = [];
    display.forEach((label, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.item = String(index);
      button.textContent = label;
      button.addEventListener("click", () => {
        // Кнопка гаснет сразу после своего клика: повторный клик по ней иначе
        // добавил бы элемент в ответ дважды.
        button.disabled = true;
        picked.push(label);
        if (picked.length === card.items.length) {
          const correct = sameOrder(picked, card.items);
          onAnswer({ grade: gradeAuto(correct), correct });
        }
      });
      host.appendChild(button);
    });
  },
};
