import { describe, expect, it } from "vitest";
import { auditCheck, auditLesson, auditStep } from "./audit";
import type { CardDraft } from "./card";
import type { CheckQuestion } from "../content/step-file";

const STEP_BODY = [
  "Стартовый loss при словаре из 65 символов равен примерно 4.17.",
  "Это натуральный логарифм 65 — модель раскладывает вероятность поровну.",
].join("\n");

function numericCard(over: Partial<CardDraft> = {}): CardDraft {
  return {
    kind: "numeric",
    concept: "стартовый loss равен логарифму размера словаря",
    question: "В словаре 1024 токена. Чему примерно равен loss необученной модели?",
    explanation: "ln(1024) ≈ 6.93.",
    answer: 6.93,
    tolerance: 0.05,
    ...over,
  } as CardDraft;
}

describe("правило: указательные обороты", () => {
  it("заворачивает карточку, ссылающуюся на текст шага", () => {
    const cards = [numericCard({ question: "Чему равен loss в примере выше?" })];
    const findings = auditStep(cards, STEP_BODY);
    expect(findings.map((f) => f.rule)).toContain("deictic");
  });

  it("пропускает самодостаточный вопрос", () => {
    expect(auditStep([numericCard()], STEP_BODY)).toEqual([]);
  });

  it("заворачивает explanation с указательным оборотом", () => {
    const cards = [numericCard({ explanation: "Как показано в примере выше, это происходит." })];
    const findings = auditStep(cards, STEP_BODY);
    expect(findings.map((f) => f.rule)).toContain("deictic");
  });

  it("заворачивает open карточку, в reference которой есть указательный оборот", () => {
    const cards: CardDraft[] = [
      {
        kind: "open",
        concept: "понимание loss",
        question: "Что такое loss?",
        explanation: "Loss — это ошибка модели.",
        reference: "Как показано в примере выше.",
      },
    ];
    const findings = auditStep(cards, STEP_BODY);
    expect(findings.map((f) => f.rule)).toContain("deictic");
  });

  it("сообщение дейктического правила читаемо, без регулярных выражений", () => {
    const cards = [numericCard({ question: "Чему равен loss в примере выше?" })];
    const findings = auditStep(cards, STEP_BODY);
    const deicticFinding = findings.find((f) => f.rule === "deictic");
    expect(deicticFinding?.message).toContain("в примере");
    expect(deicticFinding?.message).not.toContain("(?<");
  });

  describe("сравнительное «выше»/«ниже» — не дейктика", () => {
    it("пропускает «вероятность B выше вероятности A»", () => {
      const cards = [
        numericCard({ question: "Почему вероятность B выше вероятности A?" }),
      ];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });

    it("пропускает «значение ниже среднего»", () => {
      const cards = [numericCard({ question: "Что значит, что значение ниже среднего?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });

    it("пропускает «апостериорная вероятность выше априорной»", () => {
      const cards = [
        numericCard({ explanation: "Апостериорная вероятность выше априорной." }),
      ];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });

    it("пропускает «примерно выше»: «пример» — не одно и то же слово, что «примерно»", () => {
      // Регресс на открытый «[а-я]*» после корня: он цеплял «примерно» как
      // существительное «пример» с любым хвостом, и «примерно выше» —
      // обычное сравнение из текста про вероятность — заворачивалось.
      const cards = [numericCard({ question: "Значение примерно выше нормы. Почему?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });
  });

  describe("дейктическое «выше»/«ниже» — по-прежнему ловится", () => {
    it("заворачивает «см. выше»", () => {
      const cards = [numericCard({ question: "См. выше: чему равен loss?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «как показано выше» — через существующий оборот «как показано»", () => {
      // Эта фраза уже ловится записью «как показано», а не новым паттерном
      // «выше»/«ниже» — оборот «как выше» без «показано» проверен отдельным кейсом ниже.
      const cards = [numericCard({ question: "Как показано выше, чему равен loss?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает голое «как выше» без «показано»", () => {
      const cards = [numericCard({ explanation: "Ответ такой же, как выше." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «в примере выше»", () => {
      const cards = [numericCard({ question: "Чему равен loss в примере выше?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «формула выше даёт тот же ответ»", () => {
      const cards = [numericCard({ explanation: "Формула выше даёт тот же ответ." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «приведённая выше оценка»", () => {
      const cards = [numericCard({ question: "На чём основана приведённая выше оценка?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it.each([
      ["Смотри на таблице выше.", "предложный падеж"],
      ["Данные из таблицы выше.", "родительный падеж"],
    ])(
      "заворачивает падежную форму носителя, которую раньше держал открытый хвост: %s (%s)",
      (explanation) => {
        // Явные окончания должны покрывать то же самое, что раньше покрывал
        // «[а-я]*» — просто не покрывать заодно и «примерно».
        const cards = [numericCard({ explanation })];
        expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
      },
    );

    it("заворачивает «примера выше»", () => {
      const cards = [numericCard({ question: "Что общего у примера выше с этим шагом?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «кода ниже»", () => {
      const cards = [numericCard({ explanation: "Смысл понятен из кода ниже." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });
  });

  describe("рисунки, графики и разделы — тоже дейктика", () => {
    it("заворачивает «на графике выше»", () => {
      const cards = [numericCard({ explanation: "Видно на графике выше." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «в разделе выше»", () => {
      const cards = [numericCard({ question: "Это уже обсуждалось в разделе выше?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «на рисунке выше»", () => {
      const cards = [numericCard({ explanation: "ROC-кривая показана на рисунке выше." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «на диаграмме выше»", () => {
      const cards = [numericCard({ explanation: "Распределение видно на диаграмме выше." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });

    it("заворачивает «на схеме ниже»", () => {
      const cards = [numericCard({ explanation: "Порядок шагов показан на схеме ниже." })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("deictic");
    });
  });

  describe("«<существительное> выше/ниже» + объект сравнения — не дейктика", () => {
    // Регресс на сужение REFERABLE_NOUN (ab733c95): прошлая версия правила
    // несла вырез `(?!\s+нул)` ровно для этого случая, и сужение корней его
    // не унаследовало. Фаза 01 — про знак функции и графики, и «где график
    // выше нуля» там канонический вопрос.
    it("пропускает «на каком интервале график выше нуля»", () => {
      const cards = [numericCard({ question: "На каком интервале график выше нуля?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });

    it("пропускает «где график ниже нуля»", () => {
      const cards = [numericCard({ question: "Где график ниже нуля?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });

    it("пропускает «график выше оси абсцисс»", () => {
      const cards = [numericCard({ question: "Что означает, что график выше оси абсцисс?" })];
      expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("deictic");
    });
  });
});

describe("правило: пересечение чисел", () => {
  it("заворачивает вопрос про 4.17 при 4.17 в тексте шага", () => {
    const cards = [
      numericCard({
        question: "Стартовый loss равен 4.17. О чём это говорит?",
        answer: 4.17,
      }),
    ];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("number-overlap");
  });

  it("заворачивает и вопрос про размер словаря 65", () => {
    const cards = [numericCard({ question: "В словаре 65 символов. Чему равен loss?" })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("number-overlap");
  });

  it("не считает пересечением 0, 1 и 2: они есть в любом тексте", () => {
    const body = "Индексация с 0, шаг 1, ось 2.";
    const cards = [numericCard({ question: "Сколько осей у матрицы 2 на 3?", answer: 2 })];
    expect(auditStep(cards, body).map((f) => f.rule)).not.toContain("number-overlap");
  });

  it("не смотрит в explanation: разбор обязан ссылаться на материал урока", () => {
    const cards = [numericCard({ explanation: "В уроке словарь был 65, ln(65) ≈ 4.17." })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("number-overlap");
  });

  it("не смотрит в reference open карточки: ответ ссылается на материал урока", () => {
    const cards: CardDraft[] = [
      {
        kind: "open",
        concept: "понимание loss",
        question: "Что такое loss?",
        explanation: "Loss — это ошибка модели.",
        reference: "В уроке loss был 4.17 при словаре из 65 символов.",
      },
    ];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("number-overlap");
  });
});

describe("правило: ссылки на номера шагов", () => {
  it("заворачивает «см. шаг 12»", () => {
    const cards = [numericCard({ question: "См. шаг 12: чему равен loss?" })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("step-reference");
  });

  it("заворачивает open карточку со ссылкой на номер шага в reference", () => {
    const cards: CardDraft[] = [
      {
        kind: "open",
        concept: "понимание loss",
        question: "Что такое loss?",
        explanation: "Loss — это ошибка модели.",
        reference: "См. шаг 12 для полного объяснения.",
      },
    ];
    const findings = auditStep(cards, STEP_BODY);
    expect(findings.map((f) => f.rule)).toContain("step-reference");
  });
});

describe("правило: целостность ответа", () => {
  it("заворачивает choice с повторяющимися вариантами", () => {
    const cards: CardDraft[] = [
      {
        kind: "choice",
        concept: "что разделяет GPT и BERT",
        question: "Какая деталь отличает GPT от BERT?",
        explanation: "Запрет смотреть вправо.",
        options: ["Каузальная маска", "SwiGLU", "Каузальная маска"],
        correct: 0,
      },
    ];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("answer-integrity");
  });
});

describe("правила урока", () => {
  it("заворачивает две карточки на один concept", () => {
    const cards = [numericCard(), numericCard({ question: "А теперь при 2048 токенах?" })];
    expect(auditLesson(cards).map((f) => f.rule)).toContain("duplicate-concept");
  });

  it("предупреждает, если все карточки урока одного вида", () => {
    const cards = [
      numericCard({ concept: "первое" }),
      numericCard({ concept: "второе" }),
      numericCard({ concept: "третье" }),
    ];
    const findings = auditLesson(cards);
    const variety = findings.find((f) => f.rule === "kind-variety");
    expect(variety?.severity).toBe("warning");
  });

  it("не предупреждает про однообразие у урока с одной карточкой", () => {
    expect(auditLesson([numericCard()]).map((f) => f.rule)).not.toContain("kind-variety");
  });
});

describe("auditCheck — правила для вопросов внутри шага", () => {
  const body = "Стартовый loss при словаре из 65 символов равен примерно 4.17.";

  it("разрешает указательные обороты: вопрос задают в контексте шага", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Почему в примере выше стартовый loss именно такой?",
        options: [
          "Модель раскладывает вероятность поровну между токенами",
          "Модель уже что-то выучила",
          "В коде ошибка",
        ],
        correct: 0,
        explanation: "Равномерное распределение даёт ln(|V|).",
      },
    ];
    expect(auditCheck(questions, body)).toEqual([]);
  });

  it("заворачивает вопрос, ответ на который — число из текста шага", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Чему равен стартовый loss?",
        options: ["4.17", "0.0", "65"],
        correct: 0,
        explanation: "ln(65) ≈ 4.17.",
      },
    ];
    expect(auditCheck(questions, body).map((f) => f.rule)).toContain("number-answer");
  });

  it("пропускает вопрос про идею, даже если число урока стоит в условии", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Стартовый loss оказался около 4.17 при словаре из 65 символов. Почему?",
        options: [
          "Модель считает все символы равновероятными",
          "Маска не работает",
          "Скорость обучения слишком велика",
        ],
        correct: 0,
        explanation: "Равномерное распределение по |V| даёт ln(|V|).",
      },
    ];
    expect(auditCheck(questions, body)).toEqual([]);
  });

  it("заворачивает повторяющиеся варианты", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Что делает каузальная маска?",
        options: ["Запрещает смотреть вправо", "Ускоряет softmax", "Запрещает смотреть вправо"],
        correct: 0,
        explanation: "Обнуляет вес позиций правее текущей.",
      },
    ];
    expect(auditCheck(questions, body).map((f) => f.rule)).toContain("answer-integrity");
  });
});
