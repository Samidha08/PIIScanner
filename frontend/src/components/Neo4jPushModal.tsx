import React, { useState } from 'react';
import { Neo4jGraph } from '../types';

interface Props {
  neo4jGraph: Neo4jGraph;
  dbName: string;
  onClose: () => void;
}

type PushState = 'idle' | 'pushing' | 'done' | 'error';

function buildCypherScript(neo4jGraph: Neo4jGraph): string {
  const lines: string[] = [
    '// DPDPA PII Scanner — Neo4j import script',
    '// Paste this in Neo4j Browser and run with Ctrl+Enter',
    '// https://console.neo4j.io → Query',
    '',
    '// ── Clear existing data (optional — uncomment if needed) ──',
    '// MATCH (n) DETACH DELETE n;',
    '',
    '// ── Nodes ─────────────────────────────────────────────────',
  ];

  const byLabel: Record<string, Record<string, unknown>[]> = {};
  for (const node of neo4jGraph.nodes) {
    if (!byLabel[node.label]) byLabel[node.label] = [];
    byLabel[node.label].push({ id: node.id, ...node.properties });
  }
  for (const [label, batch] of Object.entries(byLabel)) {
    const propsJson = JSON.stringify(batch);
    lines.push(`UNWIND ${propsJson} AS props`);
    lines.push(`MERGE (n:\`${label}\` {id: props.id}) SET n += props;`);
    lines.push('');
  }

  lines.push('// ── Relationships ─────────────────────────────────────────');
  const byType: Record<string, { from: string; to: string }[]> = {};
  for (const rel of neo4jGraph.relationships) {
    if (!byType[rel.type]) byType[rel.type] = [];
    byType[rel.type].push({ from: rel.from, to: rel.to });
  }
  for (const [type, batch] of Object.entries(byType)) {
    const propsJson = JSON.stringify(batch);
    lines.push(`UNWIND ${propsJson} AS r`);
    lines.push(`MATCH (a {id: r.from}), (b {id: r.to})`);
    lines.push(`MERGE (a)-[:\`${type}\`]->(b);`);
    lines.push('');
  }

  lines.push('// ── View result ───────────────────────────────────────────');
  lines.push('// MATCH (n) RETURN n LIMIT 100;');

  return lines.join('\n');
}

export default function Neo4jPushModal({ neo4jGraph, dbName, onClose }: Props) {
  const [pushState, setPushState] = useState<PushState>('idle');
  const [copied, setCopied] = useState(false);

  const script = buildCypherScript(neo4jGraph);

  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dbName}_neo4j_import.cypher`;
    a.click();
    URL.revokeObjectURL(url);
    setPushState('done');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // keep these so TypeScript doesn't complain about unused imports
  const [result] = useState<{ nodeCount: number; relCount: number } | null>(null);
  const [errorMsg] = useState('');

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.neo4jLogo}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="10" fill="#008CC1" />
                <text x="11" y="15.5" textAnchor="middle" fontSize="11" fontWeight="bold" fill="white">N</text>
              </svg>
            </span>
            <div>
              <div style={styles.title}>Push to Neo4j</div>
              <div style={styles.subtitle}>{neo4jGraph.nodes.length} nodes · {neo4jGraph.relationships.length} relationships</div>
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Graph summary */}
        <div style={styles.preview}>
          <div style={styles.previewTitle}>What will be imported</div>
          <div style={styles.labelList}>
            {getLabelCounts(neo4jGraph).map(({ label, count, color }) => (
              <div key={label} style={styles.labelChip}>
                <span style={{ ...styles.labelDot, background: color }} />
                <span style={styles.labelName}>{label}</span>
                <span style={styles.labelCount}>{count}</span>
              </div>
            ))}
          </div>
          <div style={styles.relList}>
            {getRelTypeCounts(neo4jGraph).map(({ type, count }) => (
              <span key={type} style={styles.relChip}>
                →&nbsp;<strong>{type}</strong>&nbsp;({count})
              </span>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div style={styles.steps}>
          <div style={styles.stepsTitle}>How to import into Neo4j AuraDB</div>
          <div style={styles.step}><span style={styles.stepNum}>1</span> Download the Cypher script below</div>
          <div style={styles.step}><span style={styles.stepNum}>2</span> Open <strong>console.neo4j.io</strong> → click <strong>Query</strong> in the left sidebar</div>
          <div style={styles.step}><span style={styles.stepNum}>3</span> Paste the script and press <kbd style={styles.kbd}>Ctrl+Enter</kbd> to run</div>
          <div style={styles.step}><span style={styles.stepNum}>4</span> Run <code style={styles.code}>MATCH (n) RETURN n</code> to see your graph</div>
        </div>

        {/* Script preview */}
        <div style={styles.scriptBox}>
          <div style={styles.scriptHeader}>
            <span style={{ fontSize: 11, color: '#484f58' }}>neo4j_import.cypher</span>
            <span style={{ fontSize: 11, color: '#484f58' }}>{neo4jGraph.nodes.length} nodes · {neo4jGraph.relationships.length} rels</span>
          </div>
          <pre style={styles.scriptPreview}>{script.split('\n').slice(0, 8).join('\n')}{'\n'}…</pre>
        </div>

        {/* Action buttons */}
        <div style={styles.actionRow}>
          <button style={styles.downloadBtn} onClick={handleDownload}>
            ⬇ Download .cypher file
          </button>
          <button style={{ ...styles.copyBtn, background: copied ? '#1a4731' : '#21262d' }} onClick={handleCopy}>
            {copied ? '✓ Copied!' : '⎘ Copy to clipboard'}
          </button>
        </div>

        <a href="https://console.neo4j.io" target="_blank" rel="noreferrer" style={styles.browserLink}>
          Open Neo4j Browser (console.neo4j.io) →
        </a>
      </div>
    </div>
  );
}

const LABEL_COLORS: Record<string, string> = {
  Server:   '#4C8EDA',
  Database: '#F79767',
  Schema:   '#57C7E3',
  File:     '#68BDF6',
  Column:   '#6DCE9E',
  PIIType:  '#FF756E',
  User:     '#DE9BF9',
};

function getLabelCounts(g: Neo4jGraph) {
  const counts: Record<string, number> = {};
  for (const n of g.nodes) counts[n.label] = (counts[n.label] || 0) + 1;
  return Object.entries(counts).map(([label, count]) => ({
    label, count, color: LABEL_COLORS[label] || '#8b949e',
  }));
}

function getRelTypeCounts(g: Neo4jGraph) {
  const counts: Record<string, number> = {};
  for (const r of g.relationships) counts[r.type] = (counts[r.type] || 0) + 1;
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 14,
    padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto',
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  neo4jLogo: { flexShrink: 0 },
  title: { fontSize: 17, fontWeight: 700, color: '#e6edf3' },
  subtitle: { fontSize: 12, color: '#8b949e', marginTop: 2 },
  closeBtn: { background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 16, padding: 4 },

  preview: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '12px 14px', marginBottom: 14 },
  previewTitle: { fontSize: 11, fontWeight: 600, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  labelList: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  labelChip: { display: 'flex', alignItems: 'center', gap: 5, background: '#21262d', border: '1px solid #30363d', borderRadius: 20, padding: '3px 10px' },
  labelDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  labelName: { fontSize: 12, color: '#e6edf3' },
  labelCount: { fontSize: 11, color: '#8b949e', background: '#0d1117', borderRadius: 10, padding: '0 5px' },
  relList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  relChip: { fontSize: 11, color: '#8b949e', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px' },

  steps: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '14px 16px', marginBottom: 14 },
  stepsTitle: { fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 10 },
  step: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#c9d1d9', marginBottom: 8 },
  stepNum: { background: '#008CC1', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 } as React.CSSProperties,
  kbd: { background: '#21262d', border: '1px solid #484f58', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontFamily: 'monospace' },
  code: { background: '#21262d', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#58a6ff' },

  scriptBox: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, marginBottom: 14, overflow: 'hidden' },
  scriptHeader: { display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #21262d' },
  scriptPreview: { margin: 0, padding: '10px 12px', fontSize: 11, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace', overflowX: 'auto', maxHeight: 120 },

  actionRow: { display: 'flex', gap: 10, marginBottom: 12 },
  downloadBtn: {
    flex: 1, background: 'linear-gradient(135deg, #008CC1, #00acd4)',
    border: 'none', borderRadius: 8, color: '#fff', fontSize: 14,
    fontWeight: 600, padding: '11px', cursor: 'pointer',
  },
  copyBtn: {
    border: '1px solid #30363d', borderRadius: 8, color: '#8b949e',
    fontSize: 13, padding: '11px 16px', cursor: 'pointer', transition: 'background 0.2s',
  },
  browserLink: {
    display: 'block', textAlign: 'center', color: '#58a6ff',
    fontSize: 13, textDecoration: 'none', padding: '8px 0',
  },
};
