import { gradeAuto } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

/**
 * Вариант на кнопку.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const choice: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "choice") throw new Error(`ожидалась карточка choice, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    const buttons: HTMLButtonElement[] = [];
    card.options.forEach((label, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "review-option";
      button.dataset.option = String(index);
      button.textContent = label;
      button.addEventListener("click", () => {
        // Кнопки гаснут после ответа: второй клик иначе пересчитал бы оценку
        // и уехал бы вторым вызовом onAnswer.
        for (const other of buttons) other.disabled = true;
        const correct = index === card.correct;
        onAnswer({ grade: gradeAuto(correct), correct });
      });
      buttons.push(button);
      host.appendChild(button);
    });
  },
};
