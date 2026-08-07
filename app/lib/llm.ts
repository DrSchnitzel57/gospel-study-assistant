import OpenAI from 'openai';
import { type ChatCompletionCreateParamsStreaming, type ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

// Helper to safely read env vars at runtime to prevent Next.js build-time inlining
function getEnv(key: string, fallback: string = ''): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || fallback;
  }
  return fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export type LLMCallOptions = {
  enableThinking?: boolean;
  maxTokens?: number;
};

// Lazy initialization so it always reads the runtime environment
let _llmClient: OpenAI | null = null;
let _embeddingClient: OpenAI | null = null;

function getLLMClient() {
  if (!_llmClient) {
    _llmClient = new OpenAI({
      baseURL: getEnv('LLM_BASE_URL', getEnv('OPENAI_BASE_URL', 'http://localhost:8000/v1')),
      apiKey: getEnv('LLM_API_KEY', getEnv('OPENAI_API_KEY', '')),
    });
  }
  return _llmClient;
}

function getEmbeddingClient() {
  if (!_embeddingClient) {
    _embeddingClient = new OpenAI({
      baseURL: getEnv('EMBEDDING_BASE_URL', getEnv('OPENAI_BASE_URL', 'http://localhost:8000/v1')),
      apiKey: getEnv('EMBEDDING_API_KEY', getEnv('OPENAI_API_KEY', '')),
    });
  }
  return _embeddingClient;
}

export function getConfig() {
  return {
    llmBaseUrl: getEnv('LLM_BASE_URL', getEnv('OPENAI_BASE_URL', 'http://localhost:8000/v1')),
    llmModel: getEnv('LLM_MODEL', 'qwen-3.6-27b'),
    llmTimeout: parseInt(getEnv('LLM_TIMEOUT', '120000'), 10),
    llmEnableThinking: envBool('LLM_ENABLE_THINKING', true),
    llmMaxTokens: parseInt(getEnv('LLM_MAX_TOKENS', '8192'), 10),
    llmUrlIsFallback: !(getEnv('LLM_BASE_URL') || getEnv('OPENAI_BASE_URL')),
    embeddingBaseUrl: getEnv('EMBEDDING_BASE_URL', getEnv('OPENAI_BASE_URL', 'http://localhost:8000/v1')),
    embeddingModel: getEnv('EMBEDDING_MODEL', 'nomic-embed-text'),
    embeddingDimensions: parseInt(getEnv('EMBEDDING_DIMENSIONS', '1024'), 10),
    embeddingUrlIsFallback: !(getEnv('EMBEDDING_BASE_URL') || getEnv('OPENAI_BASE_URL')),
    searchMinSimilarity: parseFloat(getEnv('SEARCH_MIN_SIMILARITY', '0.15')),
    searchMaxChunks: parseInt(getEnv('SEARCH_MAX_CHUNKS', '25'), 10),
    searchMaxChunksPerDocument: parseInt(getEnv('SEARCH_MAX_CHUNKS_PER_DOCUMENT', '3'), 10),
    searchMaxDecomposedQueries: parseInt(getEnv('SEARCH_MAX_DECOMPOSED_QUERIES', '10'), 10),
    searchMinChunksPerCategory: parseInt(getEnv('SEARCH_MIN_CHUNKS_PER_CATEGORY', '2'), 10),
    searchCategoryMinSimilarity: parseFloat(getEnv('SEARCH_CATEGORY_MIN_SIMILARITY', '0.075')),
    searchMaxQuotes: parseInt(getEnv('SEARCH_MAX_QUOTES', '20'), 10),
    searchMaxQuotesPerSource: parseInt(getEnv('SEARCH_MAX_QUOTES_PER_SOURCE', '3'), 10),
    searchMinQuotesPerCategory: parseInt(getEnv('SEARCH_MIN_QUOTES_PER_CATEGORY', '2'), 10),
  };
}

export async function getEmbedding(text: string): Promise<number[]> {
  const t0 = Date.now();
  const config = getConfig();
  const response = await getEmbeddingClient().embeddings.create({
    model: config.embeddingModel,
    input: text,
  }, {
    timeout: 30000,
  });
  const elapsed = Date.now() - t0;

  if (!response.data || response.data.length === 0) {
    throw new Error('Embedding API returned empty data array');
  }
  const embedding = response.data[0].embedding;
  console.log(`[Embedding] dims=${embedding.length}, model=${config.embeddingModel}, time=${elapsed}ms`);

  if (config.embeddingDimensions && embedding.length !== config.embeddingDimensions) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions, expected ${config.embeddingDimensions}. ` +
      `Check EMBEDDING_DIMENSIONS in .env matches your model output.`
    );
  }

  return embedding;
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const t0 = Date.now();
  const config = getConfig();
  const response = await getEmbeddingClient().embeddings.create({
    model: config.embeddingModel,
    input: texts,
  }, {
    timeout: 30000,
  });
  const elapsed = Date.now() - t0;

  if (!response.data || response.data.length === 0) {
    throw new Error('Embedding API returned empty data array');
  }

  const embeddings = response.data.map((item) => item.embedding);
  console.log(`[Embedding] batch=${embeddings.length}, dims=${embeddings[0].length}, model=${config.embeddingModel}, time=${elapsed}ms`);

  for (const embedding of embeddings) {
    if (config.embeddingDimensions && embedding.length !== config.embeddingDimensions) {
      throw new Error(
        `Embedding has ${embedding.length} dimensions, expected ${config.embeddingDimensions}. ` +
        `Check EMBEDDING_DIMENSIONS in .env matches your model output.`
      );
    }
  }

  return embeddings;
}

export async function callLLM(
  messages: Array<{ role: string; content: string }>,
  opts: LLMCallOptions = {}
): Promise<string> {
  const config = getConfig();
  const enableThinking = opts.enableThinking ?? config.llmEnableThinking;
  const maxTokens = opts.maxTokens ?? config.llmMaxTokens;

  const response = await getLLMClient().chat.completions.create({
    model: config.llmModel,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: maxTokens,
    // Extra body param for llama.cpp Qwen3 template; not part of the SDK's
    // ChatCompletion params type, so the params object is cast.
    chat_template_kwargs: { enable_thinking: enableThinking },
  } as ChatCompletionCreateParamsNonStreaming, {
    timeout: config.llmTimeout,
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error('LLM API returned empty choices array');
  }
  console.log(`[LLM] think=${enableThinking} max_tokens=${maxTokens} model=${config.llmModel}`);
  return response.choices[0].message.content || '';
}

export async function* callLLMStream(
  messages: Array<{ role: string; content: string }>,
  opts: LLMCallOptions = {}
): AsyncGenerator<string> {
  const config = getConfig();
  const enableThinking = opts.enableThinking ?? config.llmEnableThinking;
  const maxTokens = opts.maxTokens ?? config.llmMaxTokens;

  const stream = await getLLMClient().chat.completions.create({
    model: config.llmModel,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: maxTokens,
    stream: true,
    chat_template_kwargs: { enable_thinking: enableThinking },
  } as ChatCompletionCreateParamsStreaming, {
    timeout: config.llmTimeout,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}
