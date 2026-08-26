import { gradeSelf, type SelfGrade } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

const SELF_GRADES: SelfGrade[] = ["again", "hard", "easy"];

/**
 * Открытый вопрос с самооценкой.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const open: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "open") throw new Error(`ожидалась карточка open, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    const reveal = doc.createElement("button");
    reveal.type = "button";
    reveal.dataset.reveal = "";
    reveal.textContent = "Показать эталон";
    reveal.addEventListener("click", () => {
      // Эталон не в разметке с самого начала: карточка иначе "отвечает
      // себе" при беглом взгляде в DOM до того, как человек подумал сам.
      reveal.disabled = true;

      const reference = doc.createElement("p");
      reference.textContent = card.reference;
      host.appendChild(reference);

      const buttons: HTMLButtonElement[] = [];
      for (const value of SELF_GRADES) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.self = value;
        button.textContent = value;
        button.addEventListener("click", () => {
          // Кнопки гаснут после ответа: второй клик иначе пересчитал бы
          // оценку и уехал бы вторым вызовом onAnswer.
          for (const other of buttons) other.disabled = true;
          onAnswer({ grade: gradeSelf(value), correct: null });
        });
        buttons.push(button);
        host.appendChild(button);
      }
    });
    host.appendChild(reveal);
  },
};
