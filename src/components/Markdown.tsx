import { useMemo } from "react";
import { normalizeMath } from "@/lib/math-notation";
import { safeLinkUrl, safeImageUrl } from "@/lib/safe-url";

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "heading"; level: number; body: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; body: string }
  | { kind: "image"; alt: string; src: string }
  | { kind: "para"; body: string };

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  // One math engine for every surface: LaTeX/ASCII math becomes real notation.
  // Code spans are left untouched so `function () {}` never gets rewritten.
  const math = (s: string) => normalizeMath(s);
  while ((match = regex.exec(text))) {
    if (match.index > last) nodes.push(math(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(<strong key={key++}>{math(token.slice(2, -2))}</strong>);
    else if (token.startsWith("`"))
      nodes.push(
        <code
          key={key++}
          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-accent"
        >
          {token.slice(1, -1)}
        </code>,
      );
    else if (token.startsWith("[")) {
      const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)!;
      const href = safeLinkUrl(m[2]!);
      if (!href) {
        // Unsafe/unknown scheme: render the label text, not a live link.
        nodes.push(<span key={key++}>{m[1]}</span>);
      } else {
        nodes.push(
          <a
            key={key++}
            href={href}
            target={href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2"
          >
            {m[1]}
          </a>,
        );
      }
    } else nodes.push(<em key={key++}>{math(token.slice(1, -1))}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(math(text.slice(last)));
  return nodes;
}

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, body: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!))
        body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", body: body.join(" ") });
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i++]!.replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (img) {
      blocks.push({ kind: "image", alt: img[1] ?? "", src: img[2]! });
      i++;
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(```|#{1,6}\s|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i]!)
    ) {
      body.push(lines[i++]!);
    }
    blocks.push({ kind: "para", body: body.join(" ") });
  }
  return blocks;
}

export function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => parse(content ?? ""), [content]);
  return (
    <div className="space-y-3 text-[0.95rem] leading-relaxed">
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return (
            <pre
              key={idx}
              className="hide-scrollbar overflow-x-auto rounded-lg border border-border bg-background/70 p-3 font-mono text-xs"
            >
              <code>{block.body}</code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const size = block.level <= 2 ? "text-lg" : "text-base";
          return (
            <p key={idx} className={`${size} font-semibold text-foreground`}>
              {inline(block.body)}
            </p>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-primary/60 pl-3 text-muted-foreground italic"
            >
              {inline(block.body)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag
              key={idx}
              className={`ml-5 space-y-1 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, k) => (
                <li key={k}>{inline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.kind === "image") {
          const src = safeImageUrl(block.src);
          if (!src) {
            return (
              <figure key={idx} className="space-y-1">
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Blocked unsafe image source.
                </div>
              </figure>
            );
          }
          return (
            <figure key={idx} className="space-y-1">
              <img
                src={src}
                alt={block.alt || "Generated image"}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-h-[26rem] w-full rounded-xl border border-border object-contain"
              />
              <figcaption className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{block.alt}</span>
                <a
                  href={src}
                  download={`${(block.alt || "ustad-image").replace(/[^\w-]+/g, "-").slice(0, 40)}.png`}
                  className="text-accent underline underline-offset-2"
                >
                  Download
                </a>
              </figcaption>
            </figure>
          );
        }
        return <p key={idx}>{inline(block.body)}</p>;
      })}
    </div>
  );
}
