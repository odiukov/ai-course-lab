"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function StepBody({ body }: { body: string }) {
  return (
    <div className="prose prose-slate max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
