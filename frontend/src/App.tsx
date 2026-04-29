import React, { useState, useRef, useCallback } from 'react';
import ConnectionForm from './components/ConnectionForm';
import GraphVisualization from './components/GraphVisualization';
import ScanProgress, { ProgressState } from './components/ScanProgress';
import SpocEntry from './components/SpocEntry';
import { ScanResult } from './types';

type AppState = 'spoc_entry' | 'idle' | 'streaming' | 'rendering' | 'done' | 'error';

const RECENT_MAX = 50;
const BATCH_INTERVAL_MS = 150; // flush progress updates at most every 150ms

const initProgress = (): ProgressState => ({
  status: '',
  dbType: '',
  databases: 0,
  totalCollections: 0,
  done: 0,
  skipped: 0,
  dbNames: [],
  recentCollections: [],
  piiFoundSoFar: 0,
  buildingGraph: false,
  graphBuildStep: 0,
  graphBuildSteps: 4,
  graphBuildMessage: '',
});

type PendingProgress = {
  done: number; skipped: number; total: number;
  piiFound: boolean; timedOut: boolean; collection: string; db: string;
};

export default function App() {
  const [appState, setAppState] = useState<AppState>('spoc_entry');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressState>(initProgress());
  const [connStr, setConnStr] = useState('');
  const [spocName, setSpocName] = useState('');

  const esRef = useRef<EventSource | null>(null);
  const scanCompletedRef = useRef(false);
  // Batch buffer for high-frequency progress events
  const pendingRef = useRef<PendingProgress[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    batchTimerRef.current = null;
    const batch = pendingRef.current.splice(0);
    if (batch.length === 0) return;

    setProgress(prev => {
      let { done, skipped, piiFoundSoFar, totalCollections } = prev;
      const newRecent = [...prev.recentCollections];
      let lastStatus = prev.status;

      for (const d of batch) {
        done = d.done;
        skipped = d.skipped;
        if (d.total) totalCollections = d.total;
        if (d.piiFound) piiFoundSoFar++;
        if (newRecent.length >= RECENT_MAX) newRecent.shift();
        newRecent.push({ name: d.collection, db: d.db, piiFound: d.piiFound, timedOut: d.timedOut });
        lastStatus = `Scanning ${d.db} / ${d.collection}`;
      }

      return { ...prev, done, skipped, totalCollections, piiFoundSoFar, recentCollections: newRecent, status: lastStatus };
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(flushPending, BATCH_INTERVAL_MS);
    }
  }, [flushPending]);

  const handleScan = async (connectionString: string) => {
    setConnStr(connectionString);
    setAppState('streaming');
    setError('');
    setResult(null);
    setProgress(initProgress());
    scanCompletedRef.current = false;
    pendingRef.current = [];
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }

    let jobId: string;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/scan/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString, spocName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start scan');
      jobId = data.jobId;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setAppState('error');
      return;
    }

    const es = new EventSource(`${import.meta.env.VITE_API_URL ?? ''}/api/scan/stream/${jobId}`);
    esRef.current = es;

    es.addEventListener('status', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setProgress(p => ({ ...p, status: d.message, dbType: d.dbType || p.dbType }));
    });

    es.addEventListener('discovered', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setProgress(p => ({
        ...p,
        databases: d.databases ?? p.databases,
        totalCollections: d.collections ?? p.totalCollections,
        dbNames: d.dbNames ?? p.dbNames,
        status: `Found ${d.collections} collection(s) across ${d.databases} database(s)`,
      }));
    });

    // High-frequency — batch instead of setState per event
    es.addEventListener('progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      pendingRef.current.push({
        done: d.done, skipped: d.skipped, total: d.total,
        piiFound: !!d.piiFound, timedOut: !!d.timedOut,
        collection: d.collection, db: d.db,
      });
      scheduleFlush();
    });

    es.addEventListener('building_graph', (e) => {
      // Flush any remaining batched progress first
      if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
      flushPending();
      const d = JSON.parse((e as MessageEvent).data);
      setProgress(p => ({
        ...p,
        buildingGraph: true,
        graphBuildStep: d.step ?? p.graphBuildStep,
        graphBuildSteps: d.steps ?? p.graphBuildSteps,
        graphBuildMessage: d.message ?? p.graphBuildMessage,
        status: d.message ?? 'Building graph…',
      }));
    });

    es.addEventListener('complete', (e) => {
      scanCompletedRef.current = true;
      if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
      flushPending();
      const graphData = JSON.parse((e as MessageEvent).data) as ScanResult;
      es.close();
      esRef.current = null;
      setResult(graphData);
      // Brief rendering state so user sees the graph-init screen
      setAppState('rendering');
    });

    es.addEventListener('error', (e) => {
      if ((e as MessageEvent).data) {
        const d = JSON.parse((e as MessageEvent).data);
        es.close();
        esRef.current = null;
        setError(d.error || 'Scan failed');
        setAppState('error');
      }
    });

    es.onerror = () => {
      if (scanCompletedRef.current) return;
      es.close();
      esRef.current = null;
      setError('Connection to scan server lost. Please try again.');
      setAppState('error');
    };
  };

  const handleCancel = () => {
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
    esRef.current?.close();
    esRef.current = null;
    setAppState('idle');
    setProgress(initProgress());
  };

  const handleSpocSubmit = (name: string) => {
    setSpocName(name);
    setAppState('idle');
  };

  const handleReset = () => {
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
    esRef.current?.close();
    esRef.current = null;
    setAppState('idle');
    setResult(null);
    setError('');
    setProgress(initProgress());
  };

  // Graph is ready — GraphVisualization handles its own internal loading state
  if ((appState === 'rendering' || appState === 'done') && result) {
    return <GraphVisualization data={result} onReset={handleReset} />;
  }

  if (appState === 'spoc_entry') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117' }}>
        <SpocEntry onSubmit={handleSpocSubmit} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {appState === 'streaming'
        ? <ScanProgress progress={progress} connectionString={connStr} onCancel={handleCancel} />
        : <ConnectionForm onScan={handleScan} loading={false} spocName={spocName} onChangeSpoc={() => setAppState('spoc_entry')} />
      }

      {appState === 'error' && (
        <div style={errorStyle}>
          <strong>⚠️ Scan failed:</strong> {error}
          <button style={dismissBtn} onClick={handleReset}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

const errorStyle: React.CSSProperties = {
  position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
  background: '#3b1219', border: '1px solid #f85149', borderRadius: 8,
  color: '#ff7b72', padding: '12px 20px', fontSize: 14, maxWidth: 540,
  display: 'flex', alignItems: 'center', gap: 12, zIndex: 999,
};
const dismissBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #f85149', borderRadius: 6,
  color: '#f85149', cursor: 'pointer', fontSize: 12, padding: '3px 10px', flexShrink: 0,
};
