import { z } from 'zod';

export const QuoteSchema = z.object({
  quote: z.string().min(10),
  source: z.string(),
  source_type: z.enum(['primary', 'secondary']),
  official_status: z.enum(['official', 'unofficial']),
  doctrinal_weight: z.enum(['core', 'supporting', 'policy', 'esoteric']),
  content_category: z.enum(['scripture', 'conference', 'manual', 'devotional', 'history']),
  reference: z.string(),
});

export const LLMResponseSchema = z.object({
  quotes: z.array(QuoteSchema).min(0).max(10),
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
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  return output;
}
