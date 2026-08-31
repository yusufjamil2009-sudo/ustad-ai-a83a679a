/**
 * Turn a finished AI chat answer into the StudyLessonContent shape the existing
 * 3D Classroom orchestrator consumes.
 *
 * Section 16 fix: the previous implementation silently discarded content with
 * `sections.slice(0, 6)`, `body.slice(0, 700)`, `objectives.slice(0, 4)` and
 * `keyPoints.slice(0, 6)`. Those caps are removed here. Long answers produce
 * many sections / objectives / key points; the timeline builder then splits
 * them semantically into multiple phases, so 100% of the answer remains teachable.
 */
import type { StudyLessonContent } from "./classroom2d/lesson";

function clean(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}

export function answerToLessonContent(question: string, answer: string): StudyLessonContent {
  const lines = answer.replace(/```[\s\S]*?```/g, "").split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  const bullets: string[] = [];
  let heading = "";
  const body: string[] = [];

  const flush = () => {
    const text = body.join(" ").trim();
    if (heading || text)
      sections.push({ heading: heading || "Explanation", body: text || heading });
    heading = "";
    body.length = 0;
  };

  for (const raw of lines) {
    if (/^\s*#{1,6}\s+/.test(raw)) {
      flush();
      heading = clean(raw);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(raw)) {
      const item = clean(raw);
      if (item) bullets.push(item);
      body.push(item);
      continue;
    }
    if (!raw.trim()) continue;
    body.push(clean(raw));
  }
  flush();

  const title = question.replace(/\?+$/, "").trim() || "USTAD answer";
  const paragraphs = sections.length ? sections : [{ heading: "Answer", body: clean(answer) }];

  const content: StudyLessonContent = {
    title,
    sections: paragraphs.map((s) => ({ heading: s.heading, body: s.body })),
  };
  if (bullets.length) content.keyPoints = bullets;
  const summaryLine = paragraphs[paragraphs.length - 1]?.body ?? "";
  if (summaryLine) content.summary = summaryLine;
  return content;
}
