import { NextResponse } from 'next/server';
import { search } from '@/lib/search';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const ipRequestCounts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  record.count += 1;
  return false;
}

// Periodically prune stale entries so the in-memory map doesn't grow unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestCounts) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      ipRequestCounts.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

export async function POST(req: Request) {
  try {
    // x-forwarded-for may be a comma-separated chain (proxies); use the leftmost client IP.
    const xff = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    const ip = xff || req.headers.get('x-real-ip') || 'default-client';
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment before searching again.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { query, filters } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    if (query.trim().length > 1000) {
      return NextResponse.json(
        { error: 'Query is too long (max 1000 characters)' },
        { status: 400 }
      );
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
