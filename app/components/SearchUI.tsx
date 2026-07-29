'use client';

import { useState, useEffect, useCallback } from 'react';
import QuoteCard from './QuoteCard';
import SourceToggle from './SourceToggle';
import type { Quote } from '@/lib/validation';

const CATEGORIES = [
  { id: 'scripture', label: 'Scriptures', default: true },
  { id: 'conference', label: 'Conference', default: true },
  { id: 'manual', label: 'Manuals', default: true },
  { id: 'devotional', label: 'Devotionals', default: true },
  { id: 'history', label: 'History', default: false },
];

export default function SearchUI() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [error, setError] = useState('');
  const [greeting, setGreeting] = useState('');
  const [historyMode, setHistoryMode] = useState(false);
  const [enabledCategories, setEnabledCategories] = useState<string[]>(
    CATEGORIES.filter(c => c.default).map(c => c.id)
  );
  const [loadingTime, setLoadingTime] = useState(0);
  const [loadingTimer, setLoadingTimer] = useState<NodeJS.Timeout | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (loadingTimer) clearTimeout(loadingTimer);
    };
  }, [loadingTimer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setLoadingTime(0);
    setNoResults(false);
    setError('');
    setGreeting('');
    setResults([]);

    // Start loading timer for user feedback
    const timer = setInterval(() => {
      setLoadingTime(prev => prev + 1);
    }, 1000);
    setLoadingTimer(timer);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          filters: {
            categories: historyMode ? ['history'] : enabledCategories,
            historyMode,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.details || data.error || 'Search failed — check Status page for diagnostics');
        return;
      }

      if (data.greeting) {
        setGreeting(data.message || 'I can help with gospel questions. Try asking about a scripture, doctrine, or Church topic.');
        return;
      }

      if (data.no_results || !data.quotes || data.quotes.length === 0) {
        setNoResults(true);
        setResults([]);
      } else {
        setResults(data.quotes);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error — check your connection');
    } finally {
      setLoading(false);
      if (loadingTimer) {
        clearInterval(loadingTimer);
        setLoadingTimer(null);
      }
    }
  }

  function toggleCategory(categoryId: string) {
    setEnabledCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  }

  // Loading status messages based on elapsed time
  const getLoadingMessage = () => {
    if (loadingTime < 3) return 'Searching scriptures and resources...';
    if (loadingTime < 10) return 'Found relevant passages, extracting quotes...';
    if (loadingTime < 20) return 'Still working — analyzing results...';
    return 'Processing — this may take a moment...';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Ask a question about the gospel'
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-gray-900 placeholder-gray-400 text-base"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium whitespace-nowrap"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={historyMode}
              onChange={e => setHistoryMode(e.target.checked)}
              className="w-4 h-4 text-accent rounded focus:ring-accent"
            />
            <span className="text-sm font-medium text-accent">Church History Mode</span>
          </label>
          {historyMode && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              Official history sources only
            </span>
          )}
        </div>

        {!historyMode && (
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map(cat => (
              <SourceToggle
                key={cat.id}
                label={cat.label}
                enabled={enabledCategories.includes(cat.id)}
                onToggle={() => toggleCategory(cat.id)}
              />
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-gray-500">{getLoadingMessage()}</p>
          {loadingTime >= 10 && (
            <p className="mt-2 text-xs text-gray-400">{loadingTime}s elapsed</p>
          )}
        </div>
      )}

      {greeting && !loading && (
        <div className="text-center py-8 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-blue-700">{greeting}</p>
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-8 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {noResults && !loading && !error && !greeting && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-600 text-lg">No direct quotes found for your query.</p>
          <p className="text-gray-400 text-sm mt-2">
            Try rephrasing, or{' '}
            <a href="/status" className="text-accent hover:underline">
              check the Status page
            </a>{' '}
            to verify data is loaded.
          </p>
        </div>
      )}

      {results.length > 0 && !loading && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 mb-4">
            Found {results.length} direct quote{results.length !== 1 ? 's' : ''}
          </p>
          {results.map((quote: Quote, index: number) => (
            <QuoteCard key={index} quote={quote} />
          ))}
        </div>
      )}
    </div>
  );
}
