import { NextResponse } from 'next/server';
import { search, isGreetingOrOffTopic } from '@/lib/search';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, filters } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Reject queries that are too long (DoS protection)
    if (query.trim().length > 1000) {
      return NextResponse.json(
        { error: 'Query is too long (max 1000 characters)' },
        { status: 400 }
      );
    }

    // Early exit for greetings - don't waste embedding/LLM calls
    if (isGreetingOrOffTopic(query.trim())) {
      return NextResponse.json({
        quotes: [],
        no_results: true,
        greeting: true,
        message: 'I can help with gospel questions. Try asking about a scripture, doctrine, or Church topic.',
      });
    }

    const result = await search(query.trim(), filters || {});
    return NextResponse.json(result);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      {
        error: 'Search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
