'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import QuoteCard from './QuoteCard';
import SourceToggle from './SourceToggle';
import { CATEGORIES, DEFAULT_CATEGORIES, getCategory } from '@/lib/categories';
import type { Quote } from '@/lib/validation';

export default function SearchUI() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [error, setError] = useState('');
  const [historyMode, setHistoryMode] = useState(false);
  const [enabledCategories, setEnabledCategories] = useState<string[]>(
    DEFAULT_CATEGORIES
  );
  const [loadingTime, setLoadingTime] = useState(0);
  const [loadingTimer, setLoadingTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('searchHistory');
    if (saved) {
      try { setSearchHistory(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

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
            ...(!historyMode && { categories: enabledCategories }),
            historyMode,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.details || data.error || 'Search failed — check Status page for diagnostics');
        return;
      }

      if (data.no_results || !data.quotes || data.quotes.length === 0) {
        setNoResults(true);
        setResults([]);
      } else {
        setResults(data.quotes);
      }

      // Save to search history
      const trimmed = query.trim();
      setSearchHistory(prev => {
        const updated = [trimmed, ...prev.filter(q => q !== trimmed)].slice(0, 10);
        localStorage.setItem('searchHistory', JSON.stringify(updated));
        return updated;
      });
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

  // Group quotes into sections per category, in canonical category order.
  const groupedResults = useMemo(() => {
    if (results.length === 0) return [];
    const groups = new Map<string, Quote[]>();
    for (const quote of results) {
      const list = groups.get(quote.content_category) || [];
      list.push(quote);
      groups.set(quote.content_category, list);
    }
    const ordered = [] as Array<{ categoryId: string; quotes: Quote[] }>;
    for (const cat of CATEGORIES) {
      const list = groups.get(cat.id);
      if (list && list.length > 0) ordered.push({ categoryId: cat.id, quotes: list });
      groups.delete(cat.id);
    }
    for (const [catId, list] of groups) {
      if (list.length > 0) ordered.push({ categoryId: catId, quotes: list });
    }
    return ordered;
  }, [results]);

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

      {searchHistory.length > 0 && !loading && results.length === 0 && (
        <div className="mb-4 relative">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showHistory ? 'Hide' : 'Show'} recent searches ({searchHistory.length})
          </button>
          {showHistory && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {searchHistory.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setQuery(q); setShowHistory(false); }}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors"
                >
                  {q.slice(0, 40)}{q.length > 40 ? '…' : ''}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setSearchHistory([]); localStorage.removeItem('searchHistory'); setShowHistory(false); }}
                className="text-xs text-red-400 hover:text-red-600 px-2 py-1 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

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

      {error && !loading && (
        <div className="text-center py-8 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {noResults && !loading && !error && (
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
        <div className="space-y-8">
          <p className="text-sm text-gray-500">
            Found {results.length} direct quote{results.length !== 1 ? 's' : ''}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {groupedResults.map((group) => {
              const category = getCategory(group.categoryId);
              return (
                <section key={group.categoryId} className="min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <h2
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${category.chipClass}`}
                    >
                      {category.label}
                    </h2>
                    <span className="text-xs text-gray-400">
                      {group.quotes.length} quote{group.quotes.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {group.quotes.map((quote: Quote, index: number) => (
                      <QuoteCard key={index} quote={quote} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
