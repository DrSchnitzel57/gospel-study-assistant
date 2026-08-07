import pool from '@/lib/db';
import { getEmbeddings, callLLM } from '@/lib/llm';
import { extractJSONFromLLMOutput, validateLLMResponse, annotateAndValidateQuotes, diversifyQuotes, type LLMResponse, type ChunkWithMetadata } from '@/lib/validation';
import { ALL_CATEGORY_IDS } from '@/lib/categories';

const MAX_CONTEXT_CHARS = 24000;
const MIN_SIMILARITY = parseFloat(process.env.SEARCH_MIN_SIMILARITY || '0.15');
const MIN_CHUNKS_FOR_LLM = parseInt(process.env.SEARCH_MIN_CHUNKS || '3', 10);
const MAX_CHUNKS = parseInt(process.env.SEARCH_MAX_CHUNKS || '25', 10);
const MAX_CHUNKS_PER_DOCUMENT = parseInt(process.env.SEARCH_MAX_CHUNKS_PER_DOCUMENT || '3', 10);
const MAX_DECOMPOSED_QUERIES = parseInt(process.env.SEARCH_MAX_DECOMPOSED_QUERIES || '10', 10);
const MIN_CHUNKS_PER_CATEGORY = parseInt(process.env.SEARCH_MIN_CHUNKS_PER_CATEGORY || '2', 10);
const CATEGORY_MIN_SIMILARITY = parseFloat(
  process.env.SEARCH_CATEGORY_MIN_SIMILARITY || String(MIN_SIMILARITY * 0.5)
);
const MAX_KEYWORD_FALLBACK_CHUNKS = 15;
const MAX_QUOTES = parseInt(process.env.SEARCH_MAX_QUOTES || '20', 10);
const MAX_QUOTES_PER_SOURCE = parseInt(process.env.SEARCH_MAX_QUOTES_PER_SOURCE || '3', 10);
const MIN_QUOTES_PER_CATEGORY = parseInt(process.env.SEARCH_MIN_QUOTES_PER_CATEGORY || '2', 10);

type SearchFilters = {
  categories?: string[];
  sourceTypes?: string[];
  officialStatuses?: string[];
  doctrinalWeights?: string[];
  historyMode?: boolean;
};

const QUERY_EXPANSIONS: Record<string, string[]> = {
  // Mental health / psychological conditions
  scrupulosity: ['anxiety about sin', 'fear of wrongdoing', 'overly conscientious', 'peace of mind', 'religious anxiety', 'worthiness', 'clean hands', 'pure heart', 'broken heart', 'contrite spirit', 'fear of god', 'worthiness anxiety'],
  ocd: ['obsessive thoughts', 'compulsion', 'repetition', 'peace of mind', 'control thoughts', 'worry'],
  anxiety: ['fear', 'worry', 'peace', 'trust', 'comfort', 'strength', 'calm', 'anxious', 'cast thy burden', 'let not your heart be troubled', 'peace of conscience', 'burden of the Lord'],
  depression: ['despair', 'hope', 'joy', 'sadness', 'comfort', 'healing', 'darkness', 'light', 'grief'],
  addiction: ['temptation', 'bondage', 'weakness', 'strength', 'freedom', 'recovery', 'habit', 'power'],
  trauma: ['suffering', 'pain', 'healing', 'comfort', 'restoration', 'brokenness', 'wounds'],
  grief: ['mourning', 'loss', 'death', 'comfort', 'sorrow', 'tears', 'bereavement'],
  loneliness: ['isolated', 'alone', 'companionship', 'friendship', 'belonging', 'community'],
  anger: ['wrath', 'fury', 'patience', 'forgiveness', 'temper', 'rage', 'peace'],
  envy: ['jealousy', 'comparison', 'contentment', 'gratitude', 'pride', 'humility'],
  shame: ['guilt', 'worthiness', 'unworthiness', 'self-worth', 'dignity', 'worth', 'atonement'],
  fear: ['anxiety', 'worry', 'courage', 'bold', 'trust', 'peace', 'comfort', 'strength'],
  doubt: ['faith', 'uncertainty', 'questioning', 'belief', 'testimony', 'evidence'],
  stress: ['burden', 'weight', 'pressure', 'rest', 'peace', 'comfort', 'strength'],
  burnout: ['exhaustion', 'weariness', 'rest', 'renewal', 'strength', 'burden'],
  'self-harm': ['self destruction', 'hopelessness', 'suffering', 'healing', 'worth', 'value'],
  suicide: ['despair', 'hopelessness', 'end life', 'worth', 'value', 'purpose', 'reason to live'],
  'eating disorder': ['body image', 'control food', 'perfection', 'self worth', 'appearance'],
  phobia: ['fear', 'anxiety', 'courage', 'bold', 'peace', 'comfort'],
  insomnia: ['sleep', 'rest', 'peace', 'comfort', 'quiet mind', 'worry at night'],
  panic: ['fear', 'anxiety', 'overwhelm', 'peace', 'calm', 'strength'],
  perfectionism: ['perfection', 'flawless', 'mistakes', 'mercy', 'grace', 'progress', 'good enough', 'worthiness', 'clean hands', 'pure heart', 'unworthy', 'acceptable before God'],
  procrastination: ['delay', 'laziness', 'diligence', 'work', 'purpose', 'action'],
  codependency: ['dependency', 'codependent', 'boundaries', 'enable', 'self sacrifice', 'love others'],

  // Core LDS Doctrinal & Theological Expansions
  grace: ['mercy', 'enabling power', 'redemption', 'gift of god', 'favor', 'jesus christ', 'salvation'],
  atonement: ['sacrifice', 'redemption', 'jesus christ', 'reconciliation', 'forgiveness', 'resurrection', 'healing'],
  covenant: ['promise', 'binding agreement', 'ordinance', 'sacred obligation', 'baptism', 'temple', 'faithfulness'],
  temple: ['house of the lord', 'holy place', 'endowment', 'sealing', 'covenants', 'ordinances', 'eternal family'],
  priesthood: ['power of god', 'authority', 'keys', 'ordinances', 'melchizedek', 'aaronic', 'service'],
  tithing: ['tenth', 'consecration', 'offerings', 'blessings of heaven', 'windows of heaven', 'sacrifice'],
  sabbath: ['holy day', 'day of rest', 'sacrament', 'worship', 'delight', 'keep holy'],
  repentance: ['change of heart', 'turn to god', 'forgiveness', 'confess', 'forsake', 'mercy'],
  revelation: ['holy ghost', 'inspiration', 'spirit', 'still small voice', 'guidance', 'personal revelation'],
  sacrament: ['remembrance', 'bread and water', 'covenant', 'body and blood', 'renew covenants'],
  worthiness: ['worthy', 'unworthy', 'clean hands', 'pure heart', 'worthiness anxiety', 'worthiness question', 'worth of a soul'],
  worth: ['dignity', 'self-worth', 'value of the soul', 'priceless', 'precious', 'divine worth'],
};

export function expandQuery(query: string): string {
  const lowerQuery = query.toLowerCase();
  const expansions: string[] = [];

  for (const [term, expandedTerms] of Object.entries(QUERY_EXPANSIONS)) {
    if (lowerQuery.includes(term)) {
      expansions.push(...expandedTerms);
    }
  }

  if (expansions.length === 0) {
    return query;
  }

  const expanded = `${query} ${[...new Set(expansions)].join(' ')}`;
  console.log(`[Search] Query expanded: "${query}" -> "${expanded}"`);
  return expanded;
}

function buildDecompositionPrompt(categories?: string[]): string {
  const categoryLine =
    categories && categories.length > 0
      ? `The user has selected these content categories to search: ${categories.join(', ')}.\n\n`
      : '';
  return `You are helping a gospel study assistant find relevant scripture and Church resource passages for a user's question.

Instead of writing search queries, write ${MAX_DECOMPOSED_QUERIES} hypothetical, perfect excerpts or passages that would directly answer the user's underlying emotional or doctrinal need. Write them exactly as they might appear in the source texts. 

To maximize recall, write a mix of styles:
1. SCRIPTURAL — Write passages in the archaic, poetic idiom of the King James Bible or Book of Mormon (e.g., "And it came to pass...", "Verily I say unto you...", "cast thy burden upon the Lord...").
2. DOCTRINAL/PROPHETIC — Write a passage in the modern, authoritative tone of a General Conference talk or church manual explaining the core doctrine.
3. PASTORAL — Write a passage offering modern comfort and pastoral counsel, addressing the emotion directly.

${categoryLine}Return ONLY a JSON array of ${MAX_DECOMPOSED_QUERIES} short string passages (1-3 sentences each). Do not include any commentary. Example:
User: "I feel anxious about whether I'm good enough for God"
[
  "And my soul was cast down, and I cried unto the Lord in my weakness, and he did comfort me, saying: My grace is sufficient for thee, for my strength is made perfect in weakness.",
  "We need not be paralyzed by perfectionism. The Savior's Atonement is not just for sinners, but for saints who are trying, failing, and trying again. He loves us in our imperfections.",
  "When feelings of inadequacy overwhelm us, we can remember that our worth is great in the sight of God. We are His children, and He asks only for a broken heart and a contrite spirit."
]`;
}

export async function decomposeQuery(query: string, categories?: string[]): Promise<string[]> {
  try {
    const raw = await callLLM([
      { role: 'system', content: buildDecompositionPrompt(categories) },
      { role: 'user', content: `User question: ${query}` },
    ]);
    const jsonStr = extractJSONFromLLMOutput(raw);
    const parsed = JSON.parse(jsonStr);
    const queries = (Array.isArray(parsed) ? parsed : parsed.queries)
      .map((q: unknown) => typeof q === 'string' ? q.trim() : '')
      .filter((q: string) => q.length > 0)
      .slice(0, MAX_DECOMPOSED_QUERIES);

    const expanded = expandQuery(query);
    const expandedQueries = expanded !== query ? [expanded] : [];
    const allQueries = [...new Set([query, ...queries, ...expandedQueries])].slice(0, MAX_DECOMPOSED_QUERIES);

    console.log(`[Search] Decomposed "${query}" into ${allQueries.length} queries: ${JSON.stringify(allQueries)}`);
    return allQueries;
  } catch (e) {
    console.log(`[Search] Query decomposition failed (${e instanceof Error ? e.message : 'unknown'}), falling back to dictionary expansion`);
    const expanded = expandQuery(query);
    return expanded === query ? [query] : [query, expanded];
  }
}

export const SYSTEM_PROMPT = `You are a scripture and Church resource retrieval assistant for members of The Church of Jesus Christ of Latter-day Saints.

YOUR TASK: Extract relevant direct quotes from the provided context chunks that help address the user's question.

GUIDELINES:
- Understand the user's underlying need, emotion, or situation, not just their literal words.
- Use deep reasoning: a passage is relevant if it addresses the principle, doctrine, or pastoral counsel behind the question — even if it does not use the same words as the user.
- Extract the key verbatim passage from each truly relevant chunk (at least a sentence or two). Do NOT force-fit irrelevant chunks. If a chunk isn't deeply relevant, skip it.
- Include the source attribution for each quote.
- Spread your selections across ALL content categories present in the chunks (scripture, conference, manual, devotional, history) — do not skip a category that has relevant material.
- Do not return more than ${MAX_QUOTES_PER_SOURCE} quotes from any single source document — prefer one strong quote per source over many from one source.
- Aim to return high-quality, impactful quotes (up to ${MAX_QUOTES}).
- Do NOT fabricate or paraphrase quotes — only quote text that appears verbatim in the provided chunks.
- If no relevant content exists, set "no_results" to true.

OUTPUT FORMAT - Return ONLY this JSON structure without any additional text, markdown formatting outside the JSON, or commentary:
{
  "quotes": [
    {
      "quote": "The text from the source",
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

The user's query is provided below. The context chunks with their metadata follow the query. Extract all relevant quotes.`;

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

  let totalChars = 0;
  let includedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkSection =
      `--- CHUNK ${i + 1} ---\n` +
      `Source: ${chunk.source}\n` +
      `Reference: ${chunk.reference}\n` +
      `Type: ${chunk.source_type} | Status: ${chunk.official_status} | Weight: ${chunk.doctrinal_weight} | Category: ${chunk.content_category}\n` +
      `Text: ${chunk.text}\n\n`;

    if (totalChars + chunkSection.length > MAX_CONTEXT_CHARS && includedChunks > 0) {
      console.log(
        `[Search] Reached max context character budget (${MAX_CONTEXT_CHARS}). Included ${includedChunks}/${chunks.length} chunks.`
      );
      break;
    }

    prompt += chunkSection;
    totalChars += chunkSection.length;
    includedChunks++;
  }

  prompt += `\nExtract all highly relevant quotes from the chunks above that directly address the user's query. Return up to ${MAX_QUOTES} quotes, with no more than ${MAX_QUOTES_PER_SOURCE} from any single source document, and spread coverage across every content category present in the chunks. Focus on quality and direct emotional/doctrinal relevance. If no truly relevant quotes exist, set no_results to true.`;
  return prompt;
}

type ChunkRow = {
  id: number;
  text: string;
  document_title: string;
  verse_reference: string;
  source_type: string;
  official_status: string;
  doctrinal_weight: string;
  content_category: string;
  similarity: number;
};

/**
 * Diversifies the retrieved chunks so the LLM context spans sources and
 * categories instead of being dominated by a few very similar documents.
 * Pass 1 round-robins across the active categories (canonical order), giving
 * each up to ceil(limit / numCategories) slots and at most
 * MAX_CHUNKS_PER_DOCUMENT chunks per source. Pass 2 fills any remaining slots
 * with the best chunks by similarity (still per-document capped).
 * The selection order doubles as the prompt order, fixing prompt-order bias.
 */
export function activeCategorySelection(
  categories?: string[]
): string[] {
  return categories && categories.length > 0 ? categories : ALL_CATEGORY_IDS;
}

export function selectDiverseChunks(
  allChunks: ChunkRow[],
  categories: string[],
  limit: number,
  maxPerDoc: number = MAX_CHUNKS_PER_DOCUMENT
): ChunkRow[] {
  if (allChunks.length <= limit) return allChunks.slice(0, limit).sort((a, b) => b.similarity - a.similarity);

  const pools = new Map<string, ChunkRow[]>();
  for (const cat of categories) {
    pools.set(cat, []);
  }
  for (const chunk of allChunks) {
    const pool = pools.get(chunk.content_category) || [];
    pool.push(chunk);
    pools.set(chunk.content_category, pool);
  }
  for (const pool of pools.values()) {
    pool.sort((a, b) => b.similarity - a.similarity);
  }

  const perDocCount = new Map<string, number>();
  const selected: ChunkRow[] = [];
  const taken = new Set<ChunkRow>();

  const canTake = (chunk: ChunkRow): boolean =>
    !taken.has(chunk) && (perDocCount.get(chunk.document_title) || 0) < maxPerDoc;

  const take = (chunk: ChunkRow) => {
    taken.add(chunk);
    perDocCount.set(chunk.document_title, (perDocCount.get(chunk.document_title) || 0) + 1);
    selected.push(chunk);
  };

  const perCatBudget = Math.ceil(limit / categories.length);

  // Pass 1 — round-robin so every selected category gets context.
  for (let i = 0; i < perCatBudget && selected.length < limit; i++) {
    for (const cat of categories) {
      if (selected.length >= limit) break;
      const pool = pools.get(cat) || [];
      const next = pool.find((c) => canTake(c));
      if (next) take(next);
    }
  }

  // Pass 2 — fill leftovers with the best remaining chunks by similarity.
  const remaining = allChunks.filter(canTake).sort((a, b) => b.similarity - a.similarity);
  for (const chunk of remaining) {
    if (selected.length >= limit) break;
    take(chunk);
  }

  console.log(
    `[Search] Diversity: ${categories.length} categories, budget ${perCatBudget}/cat, max ${maxPerDoc}/source → selected ${selected.length}/${allChunks.length} chunks`
  );
  return selected;
}

export async function searchChunks(
  embeddingQueries: string[],
  filters: {
    categories?: string[];
    sourceTypes?: string[];
    officialStatuses?: string[];
    doctrinalWeights?: string[];
    historyMode?: boolean;
  } = {}
): Promise<ChunkRow[]> {
  const embeddings = await getEmbeddings(embeddingQueries);
  const results = new Map<number, ChunkRow>();

  const activeCategories = activeCategorySelection(filters.categories);
  const { clauses, params } = buildFilterWhere(filters, { includeCategories: true });
  const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  for (const embedding of embeddings) {
    const embeddingStr = `[${embedding.join(',')}]`;
    const paramIndex = params.length + 1;
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
      LIMIT 50
    `;

    const result = await pool.query(sql, [...params, embeddingStr]);

    for (const row of result.rows) {
      const similarity = parseFloat(row.similarity);
      if (similarity < MIN_SIMILARITY) continue;
      const existing = results.get(row.id);
      if (!existing || similarity > existing.similarity) {
        results.set(row.id, toChunkRow(row, similarity));
      }
    }
  }

  const allChunks = [...results.values()].sort((a, b) => b.similarity - a.similarity);

  if (allChunks.length > 0) {
    console.log(`[Search] Multi-vector: top=${allChunks[0].similarity.toFixed(4)}, unique_above_threshold(${MIN_SIMILARITY})=${allChunks.length} across ${embeddings.length} queries`);
  }

  const vectorChunks = selectDiverseChunks(allChunks, activeCategories, MAX_CHUNKS);

  // Keyword fallback ONLY for the original literal query.
  // We do not want to run full-text search on the generated HyDE paragraphs
  // because that introduces irrelevant lexical matches.
  const keywordSeed = [...vectorChunks];
  const keywordChunks: ChunkRow[] = [];
  const originalQuery = embeddingQueries[0]; // The original user query is always first
  if (originalQuery) {
    const kw = await keywordSearch(originalQuery, filters, keywordSeed);
    keywordChunks.push(...kw);
  }
  const keywordPooled = [...new Map(keywordChunks.map((c) => [c.id, c])).values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_KEYWORD_FALLBACK_CHUNKS * 2);

  const merged = new Map<number, ChunkRow>();
  for (const c of [...keywordPooled, ...vectorChunks]) {
    const existing = merged.get(c.id);
    if (!existing || c.similarity > existing.similarity) {
      merged.set(c.id, c);
    }
  }

  // Rescue floor: if a selected category produced no/few chunks above the main
  // threshold, run a category-scoped vector search at a relaxed similarity plus
  // a category-scoped keyword pass so the LLM always gets material for every
  // selected category. Accuracy stays guarded downstream by annotation.
  const rescueChunks = await rescueWeakCategories(embeddingQueries, filters, merged, activeCategories);
  for (const c of rescueChunks) {
    const existing = merged.get(c.id);
    if (!existing || c.similarity > existing.similarity) {
      merged.set(c.id, c);
    }
  }

  return selectDiverseChunks([...merged.values()], activeCategories, MAX_CHUNKS);
}

function toChunkRow(row: any, similarity: number): ChunkRow {
  return {
    id: row.id,
    text: row.text,
    document_title: row.document_title,
    verse_reference: row.verse_reference || '',
    source_type: row.source_type,
    official_status: row.official_status,
    doctrinal_weight: row.doctrinal_weight,
    content_category: row.content_category,
    similarity,
  };
}

/**
 * Builds the SQL WHERE clauses (and params) shared by every search path.
 * `category` overrides the IN-list with a single category (used by rescues).
 */
function buildFilterWhere(
  filters: SearchFilters,
  opts: { includeCategories?: boolean; category?: string } = {}
): { clauses: string[]; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (opts.category) {
    params.push(opts.category);
    clauses.push(`d.content_category = $${p++}`);
  } else if (opts.includeCategories !== false && filters.categories && filters.categories.length > 0) {
    const placeholders = filters.categories.map(() => `$${p++}`).join(', ');
    clauses.push(`d.content_category IN (${placeholders})`);
    params.push(...filters.categories);
  }

  if (filters.sourceTypes && filters.sourceTypes.length > 0) {
    const placeholders = filters.sourceTypes.map(() => `$${p++}`).join(', ');
    clauses.push(`d.source_type IN (${placeholders})`);
    params.push(...filters.sourceTypes);
  }
  if (filters.officialStatuses && filters.officialStatuses.length > 0) {
    const placeholders = filters.officialStatuses.map(() => `$${p++}`).join(', ');
    clauses.push(`d.official_status IN (${placeholders})`);
    params.push(...filters.officialStatuses);
  }
  if (filters.doctrinalWeights && filters.doctrinalWeights.length > 0) {
    const placeholders = filters.doctrinalWeights.map(() => `$${p++}`).join(', ');
    clauses.push(`d.doctrinal_weight IN (${placeholders})`);
    params.push(...filters.doctrinalWeights);
  }
  if (filters.historyMode) {
    clauses.push(`d.official_status = 'official'`);
    if (!opts.category) clauses.push(`d.content_category = 'history'`);
  }
  return { clauses, params };
}

async function runVectorSearch(
  queryText: string,
  filters: SearchFilters,
  opts: { category?: string; threshold: number; limit: number }
): Promise<ChunkRow[]> {
  const embedding = (await getEmbeddings([queryText]))[0];
  const { clauses, params } = buildFilterWhere(filters, { includeCategories: false, category: opts.category });
  const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const paramIndex = params.length + 1;

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
    LIMIT ${opts.limit}
  `;

  const result = await pool.query(sql, [...params, `[${embedding.join(',')}]`]);
  const rows: ChunkRow[] = [];
  for (const row of result.rows) {
    const similarity = parseFloat(row.similarity);
    if (similarity < opts.threshold) continue;
    rows.push(toChunkRow(row, similarity));
  }
  return rows;
}

async function rescueWeakCategories(
  queries: string[],
  filters: SearchFilters,
  pool: Map<number, ChunkRow>,
  activeCategories: string[]
): Promise<ChunkRow[]> {
  const counts = new Map<string, number>();
  for (const c of pool.values()) {
    counts.set(c.content_category, (counts.get(c.content_category) || 0) + 1);
  }

  const probe = queries.join(' ').slice(0, 600);
  const rescued: ChunkRow[] = [];

  for (const cat of activeCategories) {
    if (filters.historyMode && cat !== 'history') continue;
    const count = counts.get(cat) || 0;
    if (count >= MIN_CHUNKS_PER_CATEGORY) continue;
    console.log(`[Search] Rescue: category "${cat}" under ${MIN_CHUNKS_PER_CATEGORY} chunks (${count} found) — relaxing to ${CATEGORY_MIN_SIMILARITY} + keyword`);
    try {
      const vector = await runVectorSearch(probe, filters, {
        category: cat,
        threshold: CATEGORY_MIN_SIMILARITY,
        limit: 20,
      });
      const keyword = await keywordSearch(probe, filters, [...pool.values()], cat);
      rescued.push(...vector, ...keyword);
    } catch (e) {
      console.log(`[Search] Rescue failed for "${cat}": ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return rescued;
}

async function keywordSearch(
  query: string,
  filters: SearchFilters,
  alreadyFound: ChunkRow[],
  onlyCategory?: string
): Promise<ChunkRow[]> {
  try {
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8);

    if (words.length === 0) return [];

    const tsqueryOr = words.join(' | ');

    let whereClauses: string[] = [
      `(to_tsvector('english', c.text) @@ websearch_to_tsquery('english', $1) OR to_tsvector('english', c.text) @@ to_tsquery('english', $2))`
    ];
    let params: any[] = [query, tsqueryOr];
    let paramIndex = 3;

    if (onlyCategory) {
      whereClauses.push(`d.content_category = $${paramIndex++}`);
      params.push(onlyCategory);
    } else if (filters.categories && filters.categories.length > 0) {
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

    const foundIds = alreadyFound.map((c) => c.id);
    if (foundIds.length > 0) {
      const placeholders = foundIds.map(() => `$${paramIndex++}`).join(', ');
      whereClauses.push(`c.id NOT IN (${placeholders})`);
      params.push(...foundIds);
    }

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
        ts_rank_cd(to_tsvector('english', c.text), to_tsquery('english', $2)) as rank
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY rank DESC
      LIMIT ${MAX_KEYWORD_FALLBACK_CHUNKS}
    `;

    const result = await pool.query(sql, params);
    const chunks = result.rows.map((row) => ({
      id: row.id,
      text: row.text,
      document_title: row.document_title,
      verse_reference: row.verse_reference || '',
      source_type: row.source_type,
      official_status: row.official_status,
      doctrinal_weight: row.doctrinal_weight,
      content_category: row.content_category,
      similarity: Math.min(0.99, parseFloat(row.rank || '0') + 0.35),
    }));

    console.log(`[Search] Keyword fallback found ${chunks.length} chunks`);
    return chunks;
  } catch (e) {
    console.log(`[Search] Keyword fallback failed: ${e instanceof Error ? e.message : 'unknown'}`);
    return [];
  }
}

export async function search(query: string, filters: {
  categories?: string[];
  sourceTypes?: string[];
  officialStatuses?: string[];
  doctrinalWeights?: string[];
  historyMode?: boolean;
} = {}) {
  const t0 = Date.now();

  console.log(`[Search] Query: "${query.slice(0, 80)}"...`);
  const decompositionCategories = filters.historyMode
    ? ['history']
    : activeCategorySelection(filters.categories);
  const queries = await decomposeQuery(query, decompositionCategories);
  const chunks = await searchChunks(queries, filters);
  console.log(`[Search] Found ${chunks.length} relevant chunks in ${Date.now() - t0}ms`);

  if (chunks.length === 0) {
    console.log(`[Search] No relevant chunks found, returning no_results`);
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
  const quoted = await extractQuotes(query, userPrompt, chunks);

  if (!quoted) {
    console.log('[Search] LLM response failed validation, returning no_results');
    return { quotes: [], no_results: true };
  }

  const before = quoted.quotes.length;
  quoted.quotes = diversifyQuotes(quoted.quotes, {
    maxTotal: MAX_QUOTES,
    maxPerSource: MAX_QUOTES_PER_SOURCE,
    minPerCategory: MIN_QUOTES_PER_CATEGORY,
    selectedCategories: filters.categories,
  });
  if (quoted.quotes.length !== before) {
    console.log(`[Search] Diversity: capped ${before} → ${quoted.quotes.length} quotes (max ${MAX_QUOTES_PER_SOURCE}/source, min ${MIN_QUOTES_PER_CATEGORY}/category)`);
  }

  console.log(`[Search] Total time: ${Date.now() - t0}ms, returning ${quoted.quotes.length} quotes`);
  return quoted;
}

const FALLBACK_INSTRUCTION = `\n\nIMPORTANT: Do NOT use any reasoning, thinking, or commentary. Begin your reply immediately with the JSON object. No markdown fences.`;

/**
 * Calls the LLM to extract quotes from context. Reasons by default, but if the
 * reasoning-enabled response fails JSON validation (e.g. it was truncated at the
 * output budget), retries once with thinking disabled for a clean, fast pass.
 */
async function extractQuotes(
  query: string,
  userPrompt: string,
  chunks: ChunkRow[]
): Promise<LLMResponse | null> {
  let t1 = Date.now();
  let rawOutput: string;
  try {
    rawOutput = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);
  } catch (e) {
    console.log(`[Search] LLM extraction call failed: ${e instanceof Error ? e.message : 'unknown'}`);
    return null;
  }
  console.log(`[Search] LLM responded in ${Date.now() - t1}ms`);
  console.log(`[Search] Raw LLM output (first 200 chars): ${rawOutput.slice(0, 200)}`);

  const parsed = tryParseQuotes(rawOutput);
  if (parsed) {
    return validateQuotes(parsed, chunks);
  }

  console.log(`[Search] Extraction output failed validation (len=${rawOutput.length}, tail: ${rawOutput.slice(-300)})`);
  console.log('[Search] Retrying extraction with thinking disabled...');

  try {
    t1 = Date.now();
    rawOutput = await callLLM(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt + FALLBACK_INSTRUCTION },
      ],
      { enableThinking: false }
    );
    console.log(`[Search] Fallback LLM responded in ${Date.now() - t1}ms`);
    console.log(`[Search] Fallback raw output (first 200 chars): ${rawOutput.slice(0, 200)}`);
  } catch (e) {
    console.log(`[Search] Fallback LLM call failed: ${e instanceof Error ? e.message : 'unknown'}`);
    return null;
  }

  const fallbackParsed = tryParseQuotes(rawOutput);
  if (!fallbackParsed) {
    console.log(`[Search] Fallback output also failed validation (len=${rawOutput.length})`);
    return null;
  }
  return validateQuotes(fallbackParsed, chunks);
}

function tryParseQuotes(rawOutput: string): LLMResponse | null {
  const jsonStr = extractJSONFromLLMOutput(rawOutput);
  return validateLLMResponse(jsonStr);
}

function validateQuotes(parsed: LLMResponse, chunks: ChunkRow[]): LLMResponse {
  const beforeCount = parsed.quotes.length;
  parsed.quotes = annotateAndValidateQuotes(parsed.quotes, chunks as ChunkWithMetadata[]);
  const afterCount = parsed.quotes.length;

  if (beforeCount !== afterCount) {
    console.log(
      `[Search] Hallucination guard: Filtered ${beforeCount - afterCount} unverified quote(s)`
    );
  }
  return parsed;
}
