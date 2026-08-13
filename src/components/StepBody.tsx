"use client";

import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { linkStepReferences, stepNumberFromHref } from "@/lib/content/step-links";

const katexOptions = {
  macros: {
    "\\lVert": String.raw`\mathopen{\vert\!\vert}`,
    "\\rVert": String.raw`\mathclose{\vert\!\vert}`,
  },
};

function normalizeInlineMath(line: string) {
  let result = "";
  let codeDelimiterLength = 0;

  for (let index = 0; index < line.length; ) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const length = end - index;
      if (codeDelimiterLength === 0) codeDelimiterLength = length;
      else if (codeDelimiterLength === length) codeDelimiterLength = 0;
      result += line.slice(index, end);
      index = end;
      continue;
    }

    if (codeDelimiterLength === 0 && line.startsWith("\\(", index)) {
      result += "$";
      index += 2;
      continue;
    }
    if (codeDelimiterLength === 0 && line.startsWith("\\)", index)) {
      result += "$";
      index += 2;
      continue;
    }

    result += line[index];
    index += 1;
  }

  return result;
}

function normalizeMath(markdown: string) {
  let fence: "`" | "~" | null = null;
  const normalized = markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^[\t ]*(`{3,}|~{3,})/)?.[1];
      if (marker) {
        const kind = marker[0] as "`" | "~";
        if (fence === null) fence = kind;
        else if (fence === kind) fence = null;
        return line;
      }
      if (fence !== null) return line;
      if (/^[\t ]*\\\[[\t ]*$/.test(line) || /^[\t ]*\\\][\t ]*$/.test(line)) {
        return "$$";
      }
      return normalizeInlineMath(line);
    })
    .join("\n");

  return normalized.replace(
    /^[\t ]*\$\$([^\n]+?)\$\$[\t ]*$/gm,
    (_line, formula: string) => `$$\n${formula.trim()}\n$$`,
  );
}

export function StepBody({
  body,
  currentStepNumber,
  onStepLink,
  hrefForStep,
}: {
  body: string;
  currentStepNumber?: number;
  onStepLink?: (stepNumber: number) => void;
  // Куда ведёт ссылка на шаг. В ридере это адрес с ?step=, в статической
  // сборке — якорь той же страницы. Адрес строится здесь, а не переписывается
  // потом в готовом HTML: он свойство самой ссылки, а не текста вокруг неё.
  hrefForStep?: (stepNumber: number) => string;
}) {
  const linked = currentStepNumber ? linkStepReferences(body, currentStepNumber) : body;
  const rendered = normalizeMath(linked);

  return (
    <div className="lesson-step-body prose prose-slate max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
        components={{
          a: ({ href, children }) => {
            const stepNumber = stepNumberFromHref(href);
            // Даже без JS это остаётся настоящей ссылкой на нужный экран.
            // В markdown номера человеческие (с 1), а query reader-а — с 0.
            const renderedHref =
              stepNumber === null
                ? href
                : (hrefForStep ?? ((number: number) => `?step=${number - 1}`))(stepNumber);
            const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
              if (stepNumber === null || !onStepLink) return;
              event.preventDefault();
              onStepLink(stepNumber);
            };
            return (
              <a href={renderedHref} onClick={navigate}>
                {children}
              </a>
            );
          },
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}
