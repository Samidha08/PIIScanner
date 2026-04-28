import React from 'react';
import { ScanSummary } from '../types';

interface Props {
  summary: ScanSummary;
  dbName: string;
  dbType: string;
}

export default function SummaryPanel({ summary, dbName, dbType }: Props) {
  const piiPct = summary.totalColumns > 0
    ? Math.round((summary.piiColumns / summary.totalColumns) * 100)
    : 0;

  const riskLevel = piiPct >= 40 ? { label: 'HIGH', color: '#f85149' }
    : piiPct >= 15 ? { label: 'MEDIUM', color: '#d29922' }
    : { label: 'LOW', color: '#3fb950' };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.dbName}>🗄️ {dbName}</span>
        <span style={{ ...styles.riskBadge, background: riskLevel.color + '22', color: riskLevel.color, borderColor: riskLevel.color + '44' }}>
          {riskLevel.label} RISK
        </span>
      </div>

      <div style={styles.statsRow}>
        <Stat label="Tables" value={summary.totalTables} icon="🗂️" color="#58a6ff" />
        <Stat label="Columns" value={summary.totalColumns} icon="📋" color="#79c0ff" />
        <Stat label="PII Columns" value={summary.piiColumns} icon="⚠️" color="#f85149" />
        <Stat label="PII %" value={`${piiPct}%`} icon="📊" color="#d29922" />
      </div>

      <div style={styles.divider} />

      <div style={styles.categoriesTitle}>PII Categories Found</div>
      <div style={styles.categories}>
        {Object.entries(summary.piiByCategory).map(([cat, info]) => (
          <div key={cat} style={styles.catRow}>
            <span style={{ ...styles.catDot, background: info.color }} />
            <span style={styles.catLabel}>{info.label}</span>
            <span style={styles.catCount}>{info.count}</span>
          </div>
        ))}
        {Object.keys(summary.piiByCategory).length === 0 && (
          <span style={{ color: '#3fb950', fontSize: 13 }}>✓ No PII detected</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{ ...styles.stat, borderColor: color + '33' }}>
      <span style={styles.statIcon}>{icon}</span>
      <span style={{ ...styles.statValue, color }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 10,
    padding: '16px', minWidth: 220,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
  dbName: { fontWeight: 700, fontSize: 14, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  riskBadge: {
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
    border: '1px solid', letterSpacing: '0.5px', whiteSpace: 'nowrap',
  },
  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 },
  stat: {
    background: '#161b22', border: '1px solid', borderRadius: 8,
    padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  },
  statIcon: { fontSize: 16 },
  statValue: { fontSize: 20, fontWeight: 700 },
  statLabel: { fontSize: 11, color: '#8b949e' },
  divider: { height: 1, background: '#30363d', margin: '4px 0 12px' },
  categoriesTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  categories: { display: 'flex', flexDirection: 'column', gap: 6 },
  catRow: { display: 'flex', alignItems: 'center', gap: 8 },
  catDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  catLabel: { flex: 1, fontSize: 12, color: '#e6edf3' },
  catCount: { fontSize: 12, fontWeight: 600, color: '#8b949e', background: '#21262d', padding: '1px 7px', borderRadius: 10 },
};
