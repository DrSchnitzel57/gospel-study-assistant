'use client';

import { useEffect, useState, useCallback } from 'react';

interface DownloadSource {
  key: string;
  label: string;
  dir: string;
  files: number;
  documents: number;
  chunks: number;
}

interface StatusData {
  db: { connected: boolean; chunks: number; documents: number; categories: Record<string, number>; lastIngested: string | null; vectorDimensions: number | null; error?: string };
  llm: { connected: boolean; model: string; baseUrl: string; pingTime: number | null; enableThinking: boolean; maxTokens: number; urlIsFallback: boolean; error?: string };
  embedding: { connected: boolean; model: string; baseUrl: string; dimensions: number; pingTime: number | null; urlIsFallback: boolean; error?: string };
  download: { mounted: boolean; sources: DownloadSource[] };
  config: { llmTimeout: number; searchMinSimilarity: number; searchMaxChunks: number; searchMaxChunksPerDocument: number; searchMaxDecomposedQueries: number; searchMinChunksPerCategory: number; searchCategoryMinSimilarity: number; searchMaxQuotes: number; searchMaxQuotesPerSource: number; searchMinQuotesPerCategory: number };
}

function StatusBadge({ connected, error }: { connected: boolean; error?: string }) {
  if (connected) {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Connected</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
      Disconnected{error ? ` — ${error.slice(0, 40)}` : ''}
    </span>
  );
}

function downloadBadge(source: DownloadSource, mounted: boolean): { label: string; cls: string } {
  if (!mounted) return { label: 'Volume not visible', cls: 'bg-gray-100 text-gray-600' };
  if (source.files === 0 && source.documents === 0) return { label: 'Not downloaded', cls: 'bg-gray-100 text-gray-600' };
  if (source.files > 0 && source.documents === 0) return { label: 'Downloaded — not yet ingested', cls: 'bg-amber-100 text-amber-800' };
  if (source.files === 0 && source.documents > 0) return { label: 'Ingested (files cleared)', cls: 'bg-green-100 text-green-800' };
  return { label: 'Downloaded & ingested', cls: 'bg-green-100 text-green-800' };
}

const COMMANDS: Array<{ step: string; title: string; desc: string; cmd: string; note?: string }> = [
  {
    step: '1',
    title: 'Download Scriptures',
    desc: 'Old Testament, New Testament, Book of Mormon, Doctrine & Covenants, Pearl of Great Price (GitHub). Skips files already present.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest download_bible',
  },
  {
    step: '2',
    title: 'Download General Conference',
    desc: 'Talks from churchofjesuschrist.org. The -it flag prompts you for which years (e.g. 2018-2026, 2015,2018,2020, or all). Without -it, all years are downloaded.',
    cmd: 'docker compose run -it --rm ingest python -m scripts.run_ingest download_conference',
    note: 'Non-interactive (with years): docker compose run --rm ingest python -m scripts.run_ingest download_conference 2018-2025',
  },
  {
    step: '3',
    title: 'Download Come, Follow Me Manuals',
    desc: 'CFM manuals via the Open Scripture API (skips existing files).',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest download_cfm',
  },
  {
    step: '4',
    title: 'Download BYU Devotionals',
    desc: 'BYU Speeches via the WordPress REST API (skips existing files).',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest download_byu',
  },
  {
    step: '5',
    title: 'Download Remaining Supplementary',
    desc: 'Gospel Topics / Church History (plus CFM manuals and BYU devotionals). Does NOT include conference — use step 2.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest download_supplementary',
  },
  {
    step: '6',
    title: 'Download Everything',
    desc: 'Bible + conference + everything else in one go.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest download_all',
  },
  {
    step: '7',
    title: 'Ingest Scriptures',
    desc: 'Chunks, embeds, and stores scripture text in the database. Idempotent — re-running skips what is already ingested.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest scripture',
  },
  {
    step: '8',
    title: 'Ingest General Conference',
    desc: 'Chunks, embeds, and stores downloaded conference talks.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest conference',
  },
  {
    step: '9',
    title: 'Ingest Manuals / Devotionals / History',
    desc: 'Chunks, embeds, and stores CFM, BYU, and Gospel Topics content.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest supplementary',
  },
  {
    step: '10',
    title: 'Ingest Everything',
    desc: 'Runs scripture + conference + supplementary ingestion.',
    cmd: 'docker compose run --rm ingest python -m scripts.run_ingest all',
  },
];

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setFetchError(`Server returned ${res.status}`);
      }
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-600">Loading status...</span>
        </div>
      </div>
    );
  }

  if (fetchError && !status) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center py-8 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 font-medium">Failed to load status</p>
          <p className="text-red-500 text-sm mt-1">{fetchError}</p>
          <button onClick={loadStatus} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const urlWarning =
    status?.llm.urlIsFallback || status?.embedding.urlIsFallback;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-primary">System Status</h1>
        <button
          onClick={loadStatus}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {urlWarning && (
        <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-5">
          <h2 className="font-semibold text-amber-800 mb-1">Endpoint URLs look wrong</h2>
          <p className="text-sm text-amber-900">
            The LLM/Embedding endpoint is using the built-in fallback{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">http://localhost:8000/v1</code>.
            Inside Docker, <code className="font-mono bg-amber-100 px-1 rounded">localhost</code> refers
            to the container itself, not your model server — which is why it is not reachable.
          </p>
          <p className="text-sm text-amber-900 mt-2">
            Set <code className="font-mono bg-amber-100 px-1 rounded">LLM_BASE_URL</code> and{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">EMBEDDING_BASE_URL</code> in{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">.env</code> to your machine's LAN IP
            (e.g. <code className="font-mono bg-amber-100 px-1 rounded">http://192.168.x.x:8000/v1</code>) or{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">http://host.docker.internal:8000/v1</code>,
            then restart the web container (<code className="font-mono bg-amber-100 px-1 rounded">docker compose up -d --build web</code>).
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Database</h2>
          <StatusBadge connected={status?.db.connected ?? false} error={status?.db.error} />
          {status?.db.connected && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Chunks</span>
                <span className="font-mono font-semibold">{status.db.chunks.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Documents</span>
                <span className="font-mono font-semibold">{status.db.documents.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Embedding vector</span>
                <span className="font-mono">
                  {status.db.vectorDimensions != null ? (
                    <span className={dbDimClass(status)}>{`vector(${status.db.vectorDimensions})`}</span>
                  ) : status.embedding.dimensions ? (
                    <span className="text-amber-600">vector(any)</span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Last ingested</span>
                <span className="font-mono text-gray-600">
                  {status.db.lastIngested ? new Date(status.db.lastIngested).toLocaleString() : 'Never'}
                </span>
              </div>
              {Object.keys(status.db.categories).length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-400 mb-2">Chunks by category</div>
                  {Object.entries(status.db.categories).map(([cat, count]) => (
                    <div key={cat} className="flex justify-between text-xs">
                      <span className="text-gray-600 capitalize">{cat}</span>
                      <span className="font-mono">{(count as number).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">LLM</h2>
          <StatusBadge connected={status?.llm.connected ?? false} error={status?.llm.error} />
          {status && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Model</span>
                <span className="font-mono text-xs truncate ml-3 max-w-[160px]">{status.llm.model || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Endpoint</span>
                <span className="font-mono text-xs truncate ml-3 max-w-[160px]">{status.llm.baseUrl || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Thinking</span>
                <span className="font-mono text-xs">{status.llm.enableThinking ? 'enabled' : 'disabled'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Max output tokens</span>
                <span className="font-mono text-xs">{status.llm.maxTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ping</span>
                <span className="font-mono">{status.llm.pingTime ? `${status.llm.pingTime}ms` : '—'}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Embeddings</h2>
          <StatusBadge connected={status?.embedding.connected ?? false} error={status?.embedding.error} />
          {status && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Model</span>
                <span className="font-mono text-xs truncate ml-1 max-w-[160px]">{status.embedding.model || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Endpoint</span>
                <span className="font-mono text-xs truncate ml-3 max-w-[160px]">{status.embedding.baseUrl || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dimensions</span>
                <span className="font-mono text-xs">
                  {status.embedding.dimensions || '—'}
                  {status.db.vectorDimensions != null &&
                    status.embedding.dimensions !== status.db.vectorDimensions && (
                      <span className="text-amber-600"> (DB: {status.db.vectorDimensions})</span>
                    )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ping</span>
                <span className="font-mono">{status.embedding.pingTime ? `${status.embedding.pingTime}ms` : '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-primary mb-1">Downloads & Ingestion</h2>
        <p className="text-sm text-gray-500 mb-4">
          Files on the ingest volume vs documents/chunks in the database. Download scripts produce the files; ingestion embeds and stores them.
        </p>

        {status?.download.mounted === false && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-4">
            <p className="text-sm text-amber-900">
              The ingest volume is not visible from this container (mounted read-only only in Docker). If you just added the mount, run{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">docker compose up -d web</code> to recreate the container.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Files on disk</th>
                <th className="py-2 pr-4">Docs in DB</th>
                <th className="py-2 pr-4">Chunks in DB</th>
              </tr>
            </thead>
            <tbody>
              {status?.download.sources.map((source) => {
                const badge = downloadBadge(source, status.download.mounted);
                return (
                  <tr key={source.key} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-800">{source.label}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{source.files.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right font-mono">{source.documents.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right font-mono">{source.chunks.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-primary mb-1">Configuration</h2>
        <p className="text-sm text-gray-500 mb-4">Effective settings (from .env / defaults).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MIN_SIMILARITY</span>
            <span className="font-mono">{status?.config.searchMinSimilarity ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MAX_CHUNKS</span>
            <span className="font-mono">{status?.config.searchMaxChunks ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MAX_CHUNKS_PER_DOCUMENT</span>
            <span className="font-mono">{status?.config.searchMaxChunksPerDocument ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MAX_DECOMPOSED_QUERIES</span>
            <span className="font-mono">{status?.config.searchMaxDecomposedQueries ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MIN_CHUNKS_PER_CATEGORY</span>
            <span className="font-mono">{status?.config.searchMinChunksPerCategory ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_CATEGORY_MIN_SIMILARITY</span>
            <span className="font-mono">{status?.config.searchCategoryMinSimilarity ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MAX_QUOTES</span>
            <span className="font-mono">{status?.config.searchMaxQuotes ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MAX_QUOTES_PER_SOURCE</span>
            <span className="font-mono">{status?.config.searchMaxQuotesPerSource ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">SEARCH_MIN_QUOTES_PER_CATEGORY</span>
            <span className="font-mono">{status?.config.searchMinQuotesPerCategory ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">LLM_MAX_TOKENS</span>
            <span className="font-mono">{status?.llm.maxTokens?.toLocaleString() ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">LLM_ENABLE_THINKING</span>
            <span className="font-mono">{status ? (status.llm.enableThinking ? 'true' : 'false') : '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">LLM_TIMEOUT</span>
            <span className="font-mono">{status?.config.llmTimeout ? `${status.config.llmTimeout}ms` : '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">EMBEDDING_DIMENSIONS</span>
            <span className="font-mono">{status?.embedding.dimensions ?? '—'}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">DB embedding column</span>
            <span className="font-mono">
              {status?.db.vectorDimensions != null ? `vector(${status.db.vectorDimensions})` : '—'}
            </span>
          </div>
          <div className="flex justify-between border-b border-gray-100 py-1.5">
            <span className="text-gray-500">Dimensions match</span>
            <span className={dbDimMatch(status) ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
              {status ? (dbDimMatch(status) ? 'yes' : 'check env vs DB') : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-primary mb-1">Ingestion Commands</h2>
        <p className="text-sm text-gray-500 mb-4">
          Run these from the machine running Docker Compose, at the repo root, with <code className="font-mono bg-gray-100 px-1 rounded">.env</code> present. Download first, then ingest.
          The web app is reached from the browser at the host IP of this machine (e.g. <code className="font-mono bg-gray-100 px-1 rounded">http://192.168.x.x:3000</code>), not <code className="font-mono bg-gray-100 px-1 rounded">localhost</code> unless you are on that machine.
        </p>
        <div className="space-y-3">
          {COMMANDS.map((c) => (
            <div key={c.step} className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-xs mr-2">{c.step}</span>
                {c.title}
              </h3>
              <p className="text-xs text-gray-500 mb-2">{c.desc}</p>
              <code className="block bg-gray-50 text-xs font-mono p-2 rounded">{c.cmd}</code>
              {c.note && <code className="block bg-gray-50 text-xs font-mono p-2 rounded mt-1">{c.note}</code>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function dbDimClass(status: StatusData | null): string {
  if (!status) return 'text-gray-600';
  if (status.db.vectorDimensions == null) return 'text-amber-600';
  if (status.embedding.dimensions > 0 && status.embedding.dimensions !== status.db.vectorDimensions) {
    return 'text-amber-600';
  }
  return 'text-gray-600';
}

function dbDimMatch(status: StatusData | null): boolean {
  return status?.db.vectorDimensions != null &&
    status.embedding.dimensions > 0 &&
    status.db.vectorDimensions === status.embedding.dimensions;
}