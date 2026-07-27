'use client';

import { useEffect, useState, useCallback } from 'react';

interface StatusData {
  db: { connected: boolean; chunks: number; documents: number; categories: Record<string, number>; lastIngested: string | null; error?: string };
  llm: { connected: boolean; model: string; baseUrl: string; pingTime: number | null; error?: string };
  embedding: { connected: boolean; model: string; baseUrl: string; dimensions: number; pingTime: number | null; error?: string };
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

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // ignore
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
                <span className="text-gray-500">Last ingested</span>
                <span className="font-mono text-gray-600">
                  {status.db.lastIngested ? new Date(status.db.lastIngested).toLocaleString() : 'Never'}
                </span>
              </div>
              {Object.keys(status.db.categories).length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-400 mb-2">By category</div>
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
                <span className="font-mono text-xs truncate ml-3 max-w-[160px]">{status.embedding.model || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Endpoint</span>
                <span className="font-mono text-xs truncate ml-3 max-w-[160px]">{status.embedding.baseUrl || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dimensions</span>
                <span className="font-mono">{status.embedding.dimensions || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ping</span>
                <span className="font-mono">{status.embedding.pingTime ? `${status.embedding.pingTime}ms` : '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-primary mb-1">Ingestion Commands</h2>
        <p className="text-sm text-gray-500 mb-4">Run these from your terminal on the server:</p>
        <div className="space-y-3">
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1">1. Download Scriptures</h3>
            <p className="text-xs text-gray-500 mb-2">Downloads OT, NT, BoM, D&C, PoGP from GitHub (~12 MB)</p>
            <code className="block bg-gray-50 text-xs font-mono p-2 rounded">docker compose run --rm ingest python -m scripts.run_ingest download_bible</code>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1">2. Ingest Scriptures</h3>
            <p className="text-xs text-gray-500 mb-2">Chunks, embeds, and stores in database (~5-10 min)</p>
            <code className="block bg-gray-50 text-xs font-mono p-2 rounded">docker compose run --rm ingest python -m scripts.run_ingest scripture</code>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1">3. Download Supplementary</h3>
            <p className="text-xs text-gray-500 mb-2">Scrapes conference, manuals, devotionals, Gospel Topics</p>
            <code className="block bg-gray-50 text-xs font-mono p-2 rounded">docker compose run --rm ingest python -m scripts.run_ingest download_supplementary</code>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1">4. Ingest Supplementary</h3>
            <p className="text-xs text-gray-500 mb-2">Chunks, embeds, and stores supplementary content</p>
            <code className="block bg-gray-50 text-xs font-mono p-2 rounded">docker compose run --rm ingest python -m scripts.run_ingest supplementary</code>
          </div>
        </div>
      </div>
    </div>
  );
}
