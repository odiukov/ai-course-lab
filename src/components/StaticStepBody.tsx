import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { linkStepReferences, stepNumberFromHref } from "@/lib/content/step-links";
import { katexOptions, normalizeMath } from "@/lib/site/markdown";

export function StaticStepBody({
  body,
  lessonSlug,
  currentStepNumber,
}: {
  body: string;
  lessonSlug?: string;
  currentStepNumber?: number;
}) {
  const linked = currentStepNumber ? linkStepReferences(body, currentStepNumber) : body;
  return (
    <div className="lesson-step-body prose prose-slate max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
        components={{
          a: ({ href, children }) => {
            const stepNumber = stepNumberFromHref(href);
            const renderedHref =
              stepNumber !== null && lessonSlug
                ? `#lesson-${lessonSlug}-step-${stepNumber}`
                : href;
            return <a href={renderedHref}>{children}</a>;
          },
        }}
      >
        {normalizeMath(linked)}
      </ReactMarkdown>
    </div>
  );
}
