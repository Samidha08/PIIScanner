import React from 'react';

export interface ProgressState {
  status: string;
  dbType: string;
  databases: number;
  totalCollections: number;
  done: number;
  skipped: number;
  dbNames: string[];
  recentCollections: Array<{ name: string; db: string; piiFound: boolean; timedOut?: boolean }>;
  piiFoundSoFar: number;
  buildingGraph: boolean;
  graphBuildStep: number;
  graphBuildSteps: number;
  graphBuildMessage: string;
}

interface Props {
  progress: ProgressState;
  connectionString: string;
  onCancel: () => void;
}

const DB_ICONS: Record<string, string> = { mongodb: '🍃', postgres: '🐘', postgresql: '🐘', mysql: '🐬', sqlite: '📁' };

const GRAPH_STEPS = [
  { icon: '🗂️', label: 'Analysing schemas' },
  { icon: '📦', label: 'Creating collection nodes' },
  { icon: '🔍', label: 'Mapping PII fields' },
  { icon: '🕸️', label: 'Finalising graph' },
];

export default function ScanProgress({ progress, connectionString, onCancel }: Props) {
  const pct = progress.totalCollections > 0
    ? Math.min(100, Math.round((progress.done / progress.totalCollections) * 100))
    : 0;

  const connLabel = connectionString.replace(/^.*@/, '').replace(/\?.*$/, '');

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.dbIcon}>{DB_ICONS[progress.dbType] || '🗄️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.title}>
              {progress.buildingGraph ? 'Building graph…' : 'Scanning database…'}
            </div>
            <div style={styles.connLabel} title={connectionString}>{connLabel}</div>
          </div>
          <button style={styles.cancelBtn} onClick={onCancel}>✕ Cancel</button>
        </div>

        {/* Progress bar */}
        <div style={styles.barTrack}>
          <div style={{
            ...styles.barFill,
            width: `${progress.buildingGraph ? 100 : pct}%`,
            background: progress.buildingGraph
              ? 'linear-gradient(90deg, #3fb950, #2ea043)'
              : 'linear-gradient(90deg, #1f6feb, #388bfd)',
            transition: progress.buildingGraph ? 'background 0.5s ease' : 'width 0.2s ease',
          }} />
        </div>

        {/* Stats */}
        <div style={styles.statsRow}>
          <Stat icon="🗂️" label="Databases"   value={progress.databases || '…'} />
          <Stat icon="📋" label="Collections"  value={progress.totalCollections || '…'} />
          <Stat icon="✅" label="Scanned"       value={progress.done}          color="#3fb950" />
          <Stat icon="⚠️" label="PII Found"     value={progress.piiFoundSoFar} color="#f85149" />
          {progress.skipped > 0 && <Stat icon="⏭️" label="Skipped" value={progress.skipped} color="#d29922" />}
          <Stat icon="%" label="Progress" value={`${pct}%`} color="#58a6ff" />
        </div>

        {/* DB chips */}
        {progress.dbNames.length > 0 && (
          <div style={styles.dbNames}>
            {progress.dbNames.map(n => <span key={n} style={styles.dbChip}>🗄️ {n}</span>)}
          </div>
        )}

        {/* ── Graph building steps ── */}
        {progress.buildingGraph ? (
          <div style={styles.graphSection}>
            <div style={styles.graphTitle}>
              <span style={styles.spinner} />
              Building graph visualisation
            </div>
            <div style={styles.stepList}>
              {GRAPH_STEPS.map((step, i) => {
                const stepNum = i + 1;
                const done = stepNum < progress.graphBuildStep;
                const active = stepNum === progress.graphBuildStep;
                return (
                  <div key={i} style={styles.stepRow}>
                    <span style={{ ...styles.stepDot, background: done ? '#3fb950' : active ? '#58a6ff' : '#21262d', boxShadow: active ? '0 0 0 3px #1f6feb44' : 'none' }}>
                      {done ? '✓' : active ? <span style={styles.stepSpinner} /> : stepNum}
                    </span>
                    <span style={{ ...styles.stepLabel, color: done ? '#3fb950' : active ? '#e6edf3' : '#484f58' }}>
                      {step.icon} {step.label}
                    </span>
                    {active && progress.graphBuildMessage && (
                      <span style={styles.stepDetail}>{progress.graphBuildMessage}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={styles.graphHint}>
              Graph size depends on the number of PII fields found — please wait…
            </div>
          </div>
        ) : (
          /* Scanning feed */
          <>
            <div style={styles.statusMsg}>
              <span style={styles.spinner} />
              {progress.status || 'Initialising…'}
            </div>
            {progress.recentCollections.length > 0 && (
              <div style={styles.feed}>
                <div style={styles.feedTitle}>Recent activity</div>
                <div style={styles.feedList}>
                  {[...progress.recentCollections].reverse().slice(0, 20).map((c, i) => (
                    <div key={i} style={styles.feedRow}>
                      <span style={{ color: c.timedOut ? '#d29922' : c.piiFound ? '#f85149' : '#3fb950', fontSize: 12 }}>
                        {c.timedOut ? '⏭' : c.piiFound ? '⚠' : '✓'}
                      </span>
                      <span style={styles.feedDb}>{c.db}</span>
                      <span style={styles.feedColl}>{c.name}</span>
                      {c.piiFound && !c.timedOut && <span style={styles.piiBadge}>PII</span>}
                      {c.timedOut && <span style={styles.skipBadge}>timeout</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: string; label: string; value: string | number; color?: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statIcon}>{icon}</span>
      <span style={{ ...styles.statVal, color: color || '#e6edf3' }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 24 },
  card: { background: '#1c2128', border: '1px solid #30363d', borderRadius: 14, padding: 28, width: '100%', maxWidth: 640 },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 },
  dbIcon: { fontSize: 32, flexShrink: 0 },
  title: { fontWeight: 700, fontSize: 17, color: '#e6edf3' },
  connLabel: { fontSize: 12, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cancelBtn: { marginLeft: 'auto', background: 'none', border: '1px solid #484f58', borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 12, padding: '5px 10px', flexShrink: 0 },
  barTrack: { height: 6, background: '#21262d', borderRadius: 3, marginBottom: 18, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  statsRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  stat: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 66, gap: 2, flex: '1 1 auto' },
  statIcon: { fontSize: 14 },
  statVal: { fontSize: 18, fontWeight: 700 },
  statLabel: { fontSize: 11, color: '#8b949e' },
  dbNames: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  dbChip: { background: '#21262d', border: '1px solid #30363d', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#8b949e' },
  statusMsg: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#8b949e', marginBottom: 14 },
  spinner: { width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#58a6ff', animation: 'spin 0.7s linear infinite', flexShrink: 0, display: 'inline-block' },

  // Graph building
  graphSection: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '14px 16px' },
  graphTitle: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, color: '#e6edf3', marginBottom: 14 },
  stepList: { display: 'flex', flexDirection: 'column', gap: 10 },
  stepRow: { display: 'flex', alignItems: 'center', gap: 10 },
  stepDot: { width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#e6edf3', flexShrink: 0, transition: 'all 0.3s ease' },
  stepSpinner: { width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' },
  stepLabel: { fontSize: 13, fontWeight: 500, transition: 'color 0.3s ease' },
  stepDetail: { fontSize: 11, color: '#58a6ff', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 },
  graphHint: { marginTop: 12, fontSize: 11, color: '#484f58', fontStyle: 'italic' },

  // Feed
  feed: { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '10px 12px' },
  feedTitle: { fontSize: 11, fontWeight: 600, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 8 },
  feedList: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' as const },
  feedRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  feedDb: { color: '#484f58', flexShrink: 0 },
  feedColl: { color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontFamily: 'JetBrains Mono, monospace' },
  piiBadge: { background: '#f8514922', color: '#f85149', border: '1px solid #f8514944', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700, flexShrink: 0 },
  skipBadge: { background: '#d2992222', color: '#d29922', border: '1px solid #d2992244', borderRadius: 4, padding: '1px 5px', fontSize: 10, flexShrink: 0 },
};
