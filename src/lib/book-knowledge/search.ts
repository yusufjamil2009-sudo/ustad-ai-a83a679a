/**
 * Knowledge retrieval / search.
 *
 * Given a curriculum resolution + a query, returns the most relevant
 * chapter/section/topic/concept/formula/question. It matches on real terms
 * (exact + related), understands Hindi / Hinglish / English via the request
 * parser's aliases, and only ever returns knowledge that was actually stored from
 * the verified source. Never fabricates a "found" answer.
 */
import type { KnowledgeItem } from "./spec";
import { searchTokens } from "./store";

export type RetrievedKnowledge = {
  items: Array<{
    id: string;
    kind: KnowledgeItem["kind"];
    chapterName: string;
    chapterNumber: number;
    sectionTitle: string | null;
    topicTitle: string | null;
    text: string;
    relevance: number;
  }>;
  total: number;
};

/** score a single item's text against the query tokens. */
function score(item: KnowledgeItem, tokens: string[]): number {
  const text = item.text.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (text.includes(t)) s += t.length;
    // related-term match for common curriculum synonyms
    if (/(velocity)/.test(t) && /(speed|speed)/.test(text.replace(/\s/g, ""))) s += 3;
    if (/(photosynth)/.test(t) && /(photosynthes|photosynthesis)/.test(text)) s += 3;
  }
  return s;
}

/** Rank and filter knowledge items against a query (returns only real matches). */
export function rankKnowledge(
  items: KnowledgeItem[],
  query: string,
  limit = 12,
): RetrievedKnowledge {
  const tokens = searchTokens(query);
  if (!tokens.length) return { items: [], total: 0 };
  const scored = items
    .map((it) => ({ item: it, relevance: score(it, tokens) }))
    .filter((x) => x.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
  const top = scored.slice(0, limit).map((x) => ({
    id: x.item.id,
    kind: x.item.kind,
    chapterName: x.item.chapterName,
    chapterNumber: x.item.chapterNumber,
    sectionTitle: x.item.sectionTitle,
    topicTitle: x.item.topicTitle,
    text: x.item.text,
    relevance: x.relevance,
  }));
  return { items: top, total: scored.length };
}
