/**
 * Renders a piece of text with real mathematical notation.
 *
 * Uses the single math engine in `@/lib/math-notation`, so a formula written by
 * the model looks the same in chat, in the exam UI and in the printed PDF.
 */
import { useMemo } from "react";
import { mathSegments } from "@/lib/math-notation";

export function MathText({ children, className }: { children: string; className?: string }) {
  const segments = useMemo(() => mathSegments(children ?? ""), [children]);
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.math ? (
          <span key={i} className="whitespace-nowrap font-medium tracking-tight text-foreground">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
