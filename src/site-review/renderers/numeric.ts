import { gradeAuto } from "../../lib/review/grade";
import type { CardRenderer } from "./types";

/**
 * Числовой ответ с допуском.
 *
 * Проверка вида не мертва: таблица RENDERERS гарантирует пару вид-отрисовщик,
 * но тип этого не выражает, и молчаливый выход оставил бы читателя перед
 * пустой карточкой без единой строки в консоли.
 */
export const numeric: CardRenderer = {
  mount(host, card, onAnswer) {
    if (card.kind !== "numeric") throw new Error(`ожидалась карточка numeric, пришла ${card.kind}`);

    const doc = host.ownerDocument;
    const question = doc.createElement("p");
    question.textContent = card.question;
    host.appendChild(question);

    const input = doc.createElement("input");
    input.type = "text";
    input.className = "review-input";
    host.appendChild(input);

    const submit = doc.createElement("button");
    submit.type = "button";
    submit.className = "review-submit";
    submit.dataset.submit = "";
    submit.textContent = "Ответить";
    submit.addEventListener("click", () => {
      // Поле и кнопка гаснут после ответа: второй клик иначе пересчитал бы
      // оценку и уехал бы вторым вызовом onAnswer.
      input.disabled = true;
      submit.disabled = true;
      // Запятая — обычный десятичный разделитель у русскоязычного читателя;
      // без замены "6,93" распарсится в NaN и уйдёт неверным ответом.
      // Пустую строку Number() превращает в 0, а не в NaN, поэтому пустой
      // ответ проверяется отдельно — иначе карточка с ответом около нуля
      // засчитала бы молчание за попадание в допуск.
      const raw = input.value.trim();
      const parsed = Number(raw.replace(",", "."));
      const correct = raw !== "" && Number.isFinite(parsed) && Math.abs(parsed - card.answer) <= card.tolerance;
      onAnswer({ grade: gradeAuto(correct), correct });
    });
    host.appendChild(submit);
  },
};
