const STEP_HREF = /^#step-(\d+)$/;

/** Номер шага в тексте — человеческий, с единицы. */
export function stepNumberFromHref(href: string | undefined): number | null {
  if (!href) return null;
  const match = STEP_HREF.exec(href);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validPreviousStep(number: number, currentStepNumber: number): boolean {
  return Number.isInteger(number) && number > 0 && number < currentStepNumber;
}

function linkedNumber(number: number): string {
  return `[${number}](#step-${number})`;
}

function linkPlainText(text: string, currentStepNumber: number): string {
  // Сначала множественные ссылки: у диапазона и списка кликабелен каждый
  // номер, а не вся фраза с одним неоднозначным адресом.
  let result = text.replace(
    /(?<![\p{L}\p{N}_])(шаг(?:и|ов|ах)\s+)(\d+)\s*([\u2013\u2014-])\s*(\d+)/giu,
    (whole, prefix: string, firstRaw: string, dash: string, lastRaw: string) => {
      const first = Number(firstRaw);
      const last = Number(lastRaw);
      if (!validPreviousStep(first, currentStepNumber) || !validPreviousStep(last, currentStepNumber)) {
        return whole;
      }
      return `${prefix}${linkedNumber(first)}${dash}${linkedNumber(last)}`;
    },
  );

  result = result.replace(
    /(?<![\p{L}\p{N}_])(шаг(?:и|ов|ах)\s+)(\d+)\s*,\s*(\d+)\s+и\s+(\d+)/giu,
    (whole, prefix: string, firstRaw: string, secondRaw: string, thirdRaw: string) => {
      const numbers = [firstRaw, secondRaw, thirdRaw].map(Number);
      if (!numbers.every((number) => validPreviousStep(number, currentStepNumber))) return whole;
      return `${prefix}${linkedNumber(numbers[0])}, ${linkedNumber(numbers[1])} и ${linkedNumber(numbers[2])}`;
    },
  );

  result = result.replace(
    /(?<![\p{L}\p{N}_])(шаг(?:и|ов|ах)\s+)(\d+)\s+и\s+(\d+)/giu,
    (whole, prefix: string, firstRaw: string, secondRaw: string) => {
      const first = Number(firstRaw);
      const second = Number(secondRaw);
      if (!validPreviousStep(first, currentStepNumber) || !validPreviousStep(second, currentStepNumber)) {
        return whole;
      }
      return `${prefix}${linkedNumber(first)} и ${linkedNumber(second)}`;
    },
  );

  return result.replace(
    /(?<![\p{L}\p{N}_])(шаг(?:е|а|у|ом)?\s+)(\d+)(?![\p{L}\p{N}_])/giu,
    (whole, prefix: string, numberRaw: string, offset: number, source: string) => {
      const number = Number(numberRaw);
      if (!validPreviousStep(number, currentStepNumber)) return whole;

      // «**Шаг 1.**» — нумерация действий внутри одного экрана, не ссылка на
      // экран урока. То же касается алгоритмов вроде «шаг 1b» (их отсекает
      // negative lookahead выше).
      const before = source.slice(Math.max(0, offset - 2), offset);
      const after = source.slice(offset + whole.length);
      if (before === "**" && /^\.\*\*/.test(after)) return whole;

      return `${prefix}[${number}](#step-${number})`;
    },
  );
}

function expandAmbiguousStepLink(link: string, currentStepNumber: number): string {
  const match = /^\[([^\]]+)\]\(#step-\d+\)$/.exec(link);
  if (!match) return link;

  const label = match[1];
  if ((label.match(/\d+/g)?.length ?? 0) < 2) return link;

  const expanded = linkPlainText(label, currentStepNumber);
  return expanded === label ? link : expanded;
}

/**
 * Делает кликабельными старые числовые ссылки, не трогая код и уже готовые
 * markdown-ссылки. Новые шаги обязаны сразу приходить с #step-N из промпта,
 * но старые уроки не должны ради этого перегенерироваться.
 */
export function linkStepReferences(markdown: string, currentStepNumber: number): string {
  let fence: "```" | "~~~" | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(```|~~~)/.exec(line)?.[1] as "```" | "~~~" | undefined;
      if (marker) {
        if (fence === marker) fence = null;
        else if (!fence) fence = marker;
        return line;
      }
      if (fence) return line;

      // Inline code and existing markdown links are opaque: вложенная ссылка
      // ломает markdown, а «шаг 3» внутри примера кода не является навигацией.
      const protectedPart = /(`+[^`\n]*`+|\[[^\]\n]+\]\([^\n)]+\))/g;
      let cursor = 0;
      let output = "";
      for (const match of line.matchAll(protectedPart)) {
        const start = match.index ?? 0;
        output += linkPlainText(line.slice(cursor, start), currentStepNumber);
        output += match[0].startsWith("[")
          ? expandAmbiguousStepLink(match[0], currentStepNumber)
          : match[0];
        cursor = start + match[0].length;
      }
      output += linkPlainText(line.slice(cursor), currentStepNumber);
      return output;
    })
    .join("\n");
}
