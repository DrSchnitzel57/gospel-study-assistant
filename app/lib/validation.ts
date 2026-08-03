import { z } from 'zod';

export const QuoteSchema = z.object({
  quote: z.string().min(5),
  source: z.string(),
  source_type: z.string(),
  official_status: z.string(),
  doctrinal_weight: z.string(),
  content_category: z.string(),
  reference: z.string(),
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

export function extractJSONFromLLMOutput(output: string): string {
  // Try code block first (most reliable)
  const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find the outermost JSON object (greedy match from last } to first {)
  const lastBrace = output.lastIndexOf('}');
  const firstBrace = output.indexOf('{');
  if (lastBrace > firstBrace) {
    return output.slice(firstBrace, lastBrace + 1);
  }

  return output;
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
      return matchRatio >= 0.7;
    });
  });
}
