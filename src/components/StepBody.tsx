"use client";

import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { linkStepReferences, stepNumberFromHref } from "@/lib/content/step-links";
import { katexOptions, normalizeMath } from "@/lib/site/markdown";

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
