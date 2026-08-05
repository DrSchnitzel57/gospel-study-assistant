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

export function validateQuotesAgainstChunks(
  quotes: Quote[],
  chunks: Array<{ text: string }>
): Quote[] {
  return quotes.filter((quote) => {
    const cleanQuoteWords = quote.quote
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));

    if (cleanQuoteWords.length < 3) return true;

    return chunks.some((chunk) => {
      const cleanChunkText = chunk.text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ');

      const chunkWordsSet = new Set(cleanChunkText.split(/\s+/));
      let matchCount = 0;

      for (const word of cleanQuoteWords) {
        if (chunkWordsSet.has(word)) {
          matchCount++;
        }
      }

      const matchRatio = matchCount / cleanQuoteWords.length;
      return matchRatio >= 0.55;
    });
  });
}
