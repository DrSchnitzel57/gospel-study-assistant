import OpenAI from 'openai';
import { type ChatCompletionCreateParamsStreaming, type ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

// LLM endpoint (chat completions)
const LLM_BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:8000/v1';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-3.6-27b';
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '120000', 10);
// Reasoning models (e.g. Qwen3.x) emit thinking/response blocks before the answer.
// Thinking can improve extraction quality but also blows the output budget and
// truncates the JSON. Default: keep thinking ON and give it a large budget;
// set LLM_ENABLE_THINKING=false to disable at the source.
const LLM_ENABLE_THINKING = envBool('LLM_ENABLE_THINKING', true);
// Max output tokens for a single completion.
const LLM_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || '8192', 10);

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export type LLMCallOptions = {
  enableThinking?: boolean;
  maxTokens?: number;
};

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
    timeout: 30000,
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

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const t0 = Date.now();
  const response = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  }, {
    timeout: 30000,
  });
  const elapsed = Date.now() - t0;

  if (!response.data || response.data.length === 0) {
    throw new Error('Embedding API returned empty data array');
  }

  const embeddings = response.data.map((item) => item.embedding);
  console.log(`[Embedding] batch=${embeddings.length}, dims=${embeddings[0].length}, model=${EMBEDDING_MODEL}, time=${elapsed}ms`);

  for (const embedding of embeddings) {
    if (EMBEDDING_DIMENSIONS && embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}. ` +
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
  const enableThinking = opts.enableThinking ?? LLM_ENABLE_THINKING;
  const maxTokens = opts.maxTokens ?? LLM_MAX_TOKENS;

  const response = await llmClient.chat.completions.create({
    model: LLM_MODEL,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: maxTokens,
    // Extra body param for llama.cpp Qwen3 template; not part of the SDK's
    // ChatCompletion params type, so the params object is cast.
    chat_template_kwargs: { enable_thinking: enableThinking },
  } as ChatCompletionCreateParamsNonStreaming, {
    timeout: LLM_TIMEOUT,
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error('LLM API returned empty choices array');
  }
  console.log(`[LLM] think=${enableThinking} max_tokens=${maxTokens} model=${LLM_MODEL}`);
  return response.choices[0].message.content || '';
}

export async function* callLLMStream(
  messages: Array<{ role: string; content: string }>,
  opts: LLMCallOptions = {}
): AsyncGenerator<string> {
  const enableThinking = opts.enableThinking ?? LLM_ENABLE_THINKING;
  const maxTokens = opts.maxTokens ?? LLM_MAX_TOKENS;

  const stream = await llmClient.chat.completions.create({
    model: LLM_MODEL,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: maxTokens,
    stream: true,
    chat_template_kwargs: { enable_thinking: enableThinking },
  } as ChatCompletionCreateParamsStreaming, {
    timeout: LLM_TIMEOUT,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}
