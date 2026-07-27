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
  const [ingestAction, setIngestAction] = useState<string | null>(null);
  const [ingestOutput, setIngestOutput] = useState('');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState('');

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

  async function runIngest(action: string) {
    setIngestAction(action);
    setIngestOutput('');
    setIngestError('');
    setIngestLoading(true);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        setIngestError(data.error || 'Ingestion failed');
      }

      setIngestOutput((data.output || '').trim());
      setTimeout(() => loadStatus(), 2000);
    } catch (err: any) {
      setIngestError(err.message);
    } finally {
      setIngestLoading(false);
    }
  }

  const ingestSteps = [
    { action: 'download_bible', label: 'Download Scriptures', desc: 'Downloads OT, NT, BoM, D&C, PoGP from GitHub (~12 MB)' },
    { action: 'scripture', label: 'Ingest Scriptures', desc: 'Chunks, embeds, and stores scriptures in the database' },
    { action: 'download_supplementary', label: 'Download Supplementary', desc: 'Scrapes conference talks, manuals, devotionals, Gospel Topics' },
    { action: 'supplementary', label: 'Ingest Supplementary', desc: 'Chunks, embeds, and stores supplementary content' },
  ];

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
        <h2 className="text-lg font-semibold text-primary mb-1">Ingestion</h2>
        <p className="text-sm text-gray-500 mb-5">Run these in order: Download, then Ingest</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {ingestSteps.map(step => (
            <div key={step.action} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-800">{step.label}</h3>
                  <p className="text-xs text-gray-500 mt-1">{step.desc}</p>
                </div>
                <button
                  onClick={() => runIngest(step.action)}
                  disabled={ingestLoading}
                  className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  {ingestLoading && ingestAction === step.action ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {ingestLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Running "{ingestAction}" — this may take several minutes...
          </div>
        )}

        {ingestError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-sm text-red-700">
            {ingestError}
          </div>
        )}

        {ingestOutput && !ingestLoading && (
          <div>
            <div className="text-xs text-gray-500 mb-2">Output:</div>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-auto max-h-64 whitespace-pre-wrap">
              {ingestOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
