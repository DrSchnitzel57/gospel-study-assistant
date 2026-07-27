import pool from '@/lib/db';
import { getEmbedding, callLLM, getConfig } from '@/lib/llm';
import { extractJSONFromLLMOutput, validateLLMResponse, type Quote, type LLMResponse } from '@/lib/validation';

export const SYSTEM_PROMPT = `You are a scripture and Church resource retrieval assistant for members of The Church of Jesus Christ of Latter-day Saints.

CRITICAL RULES - VIOLATING THESE IS UNACCEPTABLE:

1. OUTPUT ONLY DIRECT QUOTES from the provided context chunks. Never paraphrase, summarize, or synthesize.
2. Every quote must be a verbatim excerpt from one of the provided chunks.
3. Each quote must include its exact source attribution (book, chapter, verse, or talk title and date).
4. If no relevant direct quote exists in the provided chunks, set "no_results" to true and return an empty quotes array.
5. NEVER fabricate, invent, or hallucinate a quote that does not appear in the provided context.
6. NEVER provide your own interpretation, commentary, or theological analysis.
7. NEVER combine multiple sources into a synthesized answer.
8. Output must be valid JSON matching the specified schema.

OUTPUT FORMAT - Return ONLY this JSON structure:
{
  "quotes": [
    {
      "quote": "The exact verbatim text from the source",
      "source": "Book of Mormon / Conference Talk Title / Manual Name",
      "source_type": "primary or secondary",
      "official_status": "official or unofficial",
      "doctrinal_weight": "core or supporting or policy or esoteric",
      "content_category": "scripture or conference or manual or devotional or history",
      "reference": "Exact chapter:verse or talk date"
    }
  ],
  "no_results": false
}

The user's query is provided below. The context chunks with their metadata follow the query. Return only direct quotes from these chunks.`;

export function buildUserPrompt(
  query: string,
  chunks: Array<{
    text: string;
    source: string;
    reference: string;
    source_type: string;
    official_status: string;
    doctrinal_weight: string;
    content_category: string;
  }>
): string {
  let prompt = `USER QUERY: ${query}\n\n`;
  prompt += `CONTEXT CHUNKS:\n\n`;

  chunks.forEach((chunk, i) => {
    prompt += `--- CHUNK ${i + 1} ---\n`;
    prompt += `Source: ${chunk.source}\n`;
    prompt += `Reference: ${chunk.reference}\n`;
    prompt += `Type: ${chunk.source_type} | Status: ${chunk.official_status} | Weight: ${chunk.doctrinal_weight} | Category: ${chunk.content_category}\n`;
    prompt += `Text: ${chunk.text}\n\n`;
  });

  prompt += `\nReturn only direct quotes from the chunks above that are relevant to the user's query. Maximum 10 quotes. If no relevant quotes exist, set no_results to true.`;
  return prompt;
}

export async function searchChunks(
  query: string,
  filters: {
    categories?: string[];
    sourceTypes?: string[];
    officialStatuses?: string[];
    doctrinalWeights?: string[];
    historyMode?: boolean;
  } = {}
): Promise<Array<{
  id: number;
  text: string;
  document_title: string;
  verse_reference: string;
  source_type: string;
  official_status: string;
  doctrinal_weight: string;
  content_category: string;
  similarity: number;
}>> {
  const embedding = await getEmbedding(query);
  const embeddingStr = `[${embedding.join(',')}]`;

  let whereClauses: string[] = [];
  let params: any[] = [];
  let paramIndex = 1;

  if (filters.categories && filters.categories.length > 0) {
    const placeholders = filters.categories.map(() => `$${paramIndex++}`).join(', ');
    whereClauses.push(`d.content_category IN (${placeholders})`);
    params.push(...filters.categories);
  }

  if (filters.sourceTypes && filters.sourceTypes.length > 0) {
    const placeholders = filters.sourceTypes.map(() => `$${paramIndex++}`).join(', ');
    whereClauses.push(`d.source_type IN (${placeholders})`);
    params.push(...filters.sourceTypes);
  }

  if (filters.officialStatuses && filters.officialStatuses.length > 0) {
    const placeholders = filters.officialStatuses.map(() => `$${paramIndex++}`).join(', ');
    whereClauses.push(`d.official_status IN (${placeholders})`);
    params.push(...filters.officialStatuses);
  }

  if (filters.doctrinalWeights && filters.doctrinalWeights.length > 0) {
    const placeholders = filters.doctrinalWeights.map(() => `$${paramIndex++}`).join(', ');
    whereClauses.push(`d.doctrinal_weight IN (${placeholders})`);
    params.push(...filters.doctrinalWeights);
  }

  if (filters.historyMode) {
    whereClauses.push(`d.official_status = 'official'`);
    whereClauses.push(`d.content_category = 'history'`);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(embeddingStr);

  const sql = `
    SELECT
      c.id,
      c.text,
      c.verse_reference,
      d.title as document_title,
      d.source_type,
      d.official_status,
      d.doctrinal_weight,
      d.content_category,
      1 - (c.embedding <=> $${paramIndex}::vector) as similarity
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    ${whereStr}
    ORDER BY c.embedding <=> $${paramIndex}::vector
    LIMIT 30
  `;

  const result = await pool.query(sql, params);

  return result.rows.map(row => ({
    id: row.id,
    text: row.text,
    document_title: row.document_title,
    verse_reference: row.verse_reference || '',
    source_type: row.source_type,
    official_status: row.official_status,
    doctrinal_weight: row.doctrinal_weight,
    content_category: row.content_category,
    similarity: parseFloat(row.similarity),
  }));
}

export function validateQuotesAgainstChunks(
  quotes: Quote[],
  chunks: Array<{ text: string }>
): Quote[] {
  return quotes.filter(quote => {
    const normalizedQuote = quote.quote.toLowerCase().trim();
    if (normalizedQuote.length < 15) return true;

    return chunks.some(chunk => {
      const normalizedChunk = chunk.text.toLowerCase().trim();
      // Try exact substring match first (longest prefix, up to 60 chars)
      for (let len = Math.min(normalizedQuote.length, 60); len >= 20; len -= 5) {
        const substring = normalizedQuote.slice(0, len);
        if (normalizedChunk.includes(substring)) return true;
      }
      // Fallback: check first 4 words
      const quoteWords = normalizedQuote.split(/\s+/).slice(0, 4).join(' ');
      if (quoteWords.length > 10 && normalizedChunk.includes(quoteWords)) return true;
      return false;
    });
  });
}

export async function search(query: string, filters: any = {}) {
  const t0 = Date.now();

  console.log(`[Search] Query: "${query.slice(0, 80)}"...`);
  const chunks = await searchChunks(query, filters);
  console.log(`[Search] Found ${chunks.length} chunks in ${Date.now() - t0}ms`);
  if (chunks.length > 0) {
    console.log(`[Search] Top similarity: ${chunks[0].similarity.toFixed(4)}`);
  }

  if (chunks.length === 0) {
    console.log('[Search] No chunks found, returning no_results');
    return { quotes: [], no_results: true };
  }

  const contextChunks = chunks.map(c => ({
    text: c.text,
    source: c.document_title,
    reference: c.verse_reference,
    source_type: c.source_type,
    official_status: c.official_status,
    doctrinal_weight: c.doctrinal_weight,
    content_category: c.content_category,
  }));

  const userPrompt = buildUserPrompt(query, contextChunks);
  const t1 = Date.now();
  const rawOutput = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);
  console.log(`[Search] LLM responded in ${Date.now() - t1}ms`);
  console.log(`[Search] Raw LLM output (first 200 chars): ${rawOutput.slice(0, 200)}`);

  const jsonStr = extractJSONFromLLMOutput(rawOutput);
  const parsed = validateLLMResponse(jsonStr);

  if (!parsed) {
    console.log('[Search] LLM response failed validation, returning no_results');
    return { quotes: [], no_results: true };
  }

  const before = parsed.quotes.length;
  parsed.quotes = validateQuotesAgainstChunks(parsed.quotes, chunks);
  const after = parsed.quotes.length;
  if (before !== after) {
    console.log(`[Search] validateQuotesAgainstChunks: ${before} -> ${after} quotes`);
  }

  console.log(`[Search] Total time: ${Date.now() - t0}ms, returning ${parsed.quotes.length} quotes`);
  return parsed;
}
