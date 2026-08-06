import { z } from 'zod';

export const QuoteSchema = z.object({
  quote: z.string().min(3),
  source: z.string().optional().default('Church Resource'),
  source_type: z.string().optional().default('primary'),
  official_status: z.string().optional().default('official'),
  doctrinal_weight: z.string().optional().default('core'),
  content_category: z.string().optional().default('scripture'),
  reference: z.string().optional().default(''),
});

export const LLMResponseSchema = z.object({
  quotes: z.array(QuoteSchema).min(0).max(50),
  no_results: z.boolean().optional(),
});

export type Quote = z.infer<typeof QuoteSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export function validateLLMResponse(raw: string): LLMResponse | null {
  try {
    const json = JSON.parse(raw);
    return LLMResponseSchema.parse(json);
  } catch {
    return null;
  }
}

/**
 * Strip reasoning/thinking blocks that reasoning models may emit inline
 * (defense in depth — llama.cpp normally removes them when the turn completes,
 * but a truncated response can leave partial markers in the content).
 */
export function stripReasoningFromLLMOutput(output: string): string {
  let text = output;
  const markers: Array<{ start: string; end: string }> = [
    { start: "|thinking|", end: "|response|" },
    { start: "<thinking>", end: "</thinking>" },
    { start: "<|thinking|>", end: "<|response|>" },
    { start: "|think|>", end: "|" },
  ];

  for (const { start, end } of markers) {
    const startIdx = text.toLowerCase().indexOf(start.toLowerCase());
    if (startIdx === -1) continue;
    const endIdx = text.toLowerCase().indexOf(end.toLowerCase(), startIdx + start.length);
    if (endIdx === -1) continue;
    text = text.slice(0, startIdx).trimEnd() + '\n' + text.slice(endIdx + end.length).trimStart();
    return text;
  }

  // Fallback: Qwen3-style "reasoning_content" section introduced by a marker line.
  const sectionMatch = text.match(/\n\s*(thinking|reasoning)\s*([\s\S]*?)\n\s*(answer|response)\s*\n/i);
  if (sectionMatch && sectionMatch.index !== undefined) {
    return text.slice(0, sectionMatch.index).trim() + '\n' + text.slice(sectionMatch.index + sectionMatch[0].length).trimStart();
  }

  return text;
}

export function extractJSONFromLLMOutput(output: string): string {
  // Drop reasoning content if a model emitted it inline (defense in depth).
  const cleanOutput = stripReasoningFromLLMOutput(output);
  // Try code block first (most reliable)
  const codeBlockMatch = cleanOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find the outermost JSON object (greedy match from last } to first {)
  const lastBrace = cleanOutput.lastIndexOf('}');
  const firstBrace = cleanOutput.indexOf('{');
  if (lastBrace > firstBrace) {
    return cleanOutput.slice(firstBrace, lastBrace + 1);
  }

  return cleanOutput;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'have', 'will', 'shall',
  'they', 'them', 'their', 'which', 'were', 'was', 'his', 'her', 'him', 'from', 'but',
  'not', 'are', 'all', 'one', 'our', 'who', 'what', 'when', 'then', 'there', 'into',
  'upon', 'because', 'unto', 'even', 'these', 'those', 'said', 'lord', 'god',
]);

export type ChunkWithMetadata = {
  text: string;
  document_title: string;
  content_category: string;
};

export function quoteChunkMatch(quoteText: string, chunkText: string): number {
  const cleanQuoteWords = quoteText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (cleanQuoteWords.length === 0) return 0;

  const cleanChunkText = chunkText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ');

  const chunkWordsSet = new Set(cleanChunkText.split(/\s+/));
  let matchCount = 0;

  for (const word of cleanQuoteWords) {
    if (chunkWordsSet.has(word)) {
      matchCount++;
    }
  }

  return matchCount / cleanQuoteWords.length;
}

/**
 * Hallucination guard with metadata annotation. Each quote is matched against
 * the context chunks using fuzzy word overlap; quotes that match no chunk are
 * dropped. Matched quotes are annotated with the chunk's authoritative
 * document_title and content_category, so downstream per-source/per-category
 * caps and the UI never rely on the LLM's (possibly sloppy) attribution.
 * Very short quotes (< 3 significant words) that match nothing are kept with
 * their LLM-provided metadata, mirroring the previous lenient behavior.
 */
export function annotateAndValidateQuotes(
  quotes: Quote[],
  chunks: ChunkWithMetadata[]
): Quote[] {
  const result: Quote[] = [];

  for (const quote of quotes) {
    const cleanQuoteWords = quote.quote
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));

    let bestMatch = 0;
    let bestChunk: ChunkWithMetadata | null = null;

    for (const chunk of chunks) {
      const ratio = quoteChunkMatch(quote.quote, chunk.text);
      if (ratio > bestMatch) {
        bestMatch = ratio;
        bestChunk = chunk;
      }
    }

    if (bestChunk && bestMatch >= 0.55) {
      result.push({
        ...quote,
        source: bestChunk.document_title,
        content_category: bestChunk.content_category,
      });
    } else if (cleanQuoteWords.length < 3) {
      result.push(quote);
    }
  }

  return result;
}

export type DiversifyOptions = {
  maxTotal: number;
  maxPerSource: number;
  minPerCategory: number;
  selectedCategories?: string[];
};

/**
 * Spreads quotes across sources and categories:
 * - Hard cap: at most `maxPerSource` quotes from any single source document.
 * - Soft minimum: each selected category gets at least `minPerCategory` quotes
 *   (if content exists), then remaining slots fill up to `maxTotal` by
 *   relevance order. The minimum scales with how many categories are selected.
 * Output is ordered by the provided category order (grouped display order).
 */
export function diversifyQuotes(
  quotes: Quote[],
  opts: DiversifyOptions,
  categoryOrder: string[] = []
): Quote[] {
  const { maxTotal, maxPerSource, minPerCategory, selectedCategories } = opts;

  const present = [...new Set(quotes.map((q) => q.content_category))];
  const activeCategories = selectedCategories && selectedCategories.length > 0
    ? selectedCategories
    : present;
  const order = categoryOrder.length > 0 ? categoryOrder : activeCategories;

  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const kept: Quote[] = [];
  const originalIndex = new Map<Quote, number>();
  quotes.forEach((q, i) => originalIndex.set(q, i));

  const inc = (map: Map<string, number>, key: string) => {
    const next = (map.get(key) || 0) + 1;
    map.set(key, next);
    return next;
  };

  // Pass 1 — guarantee each selected category its minimum.
  for (const category of activeCategories) {
    for (const quote of quotes) {
      if (kept.length >= maxTotal) break;
      if (quote.content_category !== category) continue;
      if ((categoryCounts.get(category) || 0) >= minPerCategory) break;
      if ((sourceCounts.get(quote.source) || 0) >= maxPerSource) continue;
      kept.push(quote);
      inc(sourceCounts, quote.source);
      inc(categoryCounts, quote.content_category);
    }
  }

  // Pass 2 — fill remaining slots by relevance, still per-source capped.
  for (const quote of quotes) {
    if (kept.length >= maxTotal) break;
    if (kept.includes(quote)) continue;
    if ((sourceCounts.get(quote.source) || 0) >= maxPerSource) continue;
    kept.push(quote);
    inc(sourceCounts, quote.source);
    inc(categoryCounts, quote.content_category);
  }

  return kept.sort((a, b) => {
    const aCat = order.indexOf(a.content_category);
    const bCat = order.indexOf(b.content_category);
    if (aCat !== bCat) return (aCat === -1 ? order.length : aCat) - (bCat === -1 ? order.length : bCat);
    return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
  });
}
