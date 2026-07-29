import OpenAI from 'openai';

// LLM endpoint (chat completions)
const LLM_BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:8000/v1';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-3.6-27b';

// Embedding endpoint (vector embeddings)
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:8000/v1';
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10);

const llmClient = new OpenAI({
  baseURL: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
});

const embeddingClient = new OpenAI({
  baseURL: EMBEDDING_BASE_URL,
  apiKey: EMBEDDING_API_KEY,
});

export function getConfig() {
  return {
    llmBaseUrl: LLM_BASE_URL,
    llmModel: LLM_MODEL,
    embeddingBaseUrl: EMBEDDING_BASE_URL,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  };
}

export async function getEmbedding(text: string): Promise<number[]> {
  const t0 = Date.now();
  const response = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  }, {
    timeout: 60000,
  });
  const elapsed = Date.now() - t0;

  if (!response.data || response.data.length === 0) {
    throw new Error('Embedding API returned empty data array');
  }
  const embedding = response.data[0].embedding;
  console.log(`[Embedding] dims=${embedding.length}, model=${EMBEDDING_MODEL}, time=${elapsed}ms`);

  if (EMBEDDING_DIMENSIONS && embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}. ` +
      `Check EMBEDDING_DIMENSIONS in .env matches your model output.`
    );
  }

  return embedding;
}

export async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const response = await llmClient.chat.completions.create({
    model: LLM_MODEL,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: 4096,
  }, {
    timeout: 120000,
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error('LLM API returned empty choices array');
  }
  return response.choices[0].message.content || '';
}
