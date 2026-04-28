import React from 'react';
import { GraphNode } from '../types';

interface Props {
  node: GraphNode | null;
  onClose: () => void;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: '#f85149',
  MEDIUM: '#d29922',
  LOW: '#3fb950',
};

export default function NodeDetailPanel({ node, onClose }: Props) {
  if (!node) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={{ ...styles.typeBadge, background: node.color + '22', color: node.color, borderColor: node.color + '55' }}>
          {node.type.replace('_', ' ').toUpperCase()}
        </span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={styles.nodeLabel}>{node.label}</div>

      <div style={styles.divider} />

      {/* Database node */}
      {node.type === 'database' && (
        <Field label="Engine" value={node.dbType?.toUpperCase() || '—'} />
      )}

      {/* Table node */}
      {node.type === 'table' && (
        <>
          <Field label="Row Count" value={node.rowCount?.toLocaleString() || '—'} />
          <Field label="Total Columns" value={node.columnCount ?? '—'} />
          <Field label="PII Columns" value={node.piiColumnCount ?? 0} highlight={!!node.piiColumnCount} />
          <Field label="PII Risk" value={node.hasPii ? '⚠️ Contains PII' : '✓ Clean'} highlight={node.hasPii} />
        </>
      )}

      {/* Column node */}
      {node.type === 'column' && (
        <>
          <Field label="Data Type" value={node.dataType || '—'} />
          <Field label="Optional" value={node.nullable ? 'Yes' : 'No'} />
          <Field label="PII Detected" value={node.hasPii ? `Yes (${node.piiMatches?.length} category)` : 'No'} highlight={node.hasPii} />
          {node.piiMatches && node.piiMatches.length > 0 && (
            <div style={styles.matchesSection}>
              <div style={styles.matchesTitle}>PII Classifications</div>
              {node.piiMatches.map((m, i) => (
                <div key={i} style={{ ...styles.matchCard, borderLeftColor: m.categoryInfo.color }}>
                  <div style={styles.matchHeader}>
                    <span style={{ fontSize: 16 }}>{m.categoryInfo.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{m.categoryInfo.label}</span>
                    <span style={{ ...styles.confBadge, background: CONFIDENCE_COLOR[m.confidence] + '22', color: CONFIDENCE_COLOR[m.confidence], borderColor: CONFIDENCE_COLOR[m.confidence] + '55' }}>
                      {m.confidence}
                    </span>
                  </div>
                  <div style={styles.matchMeta}>{m.categoryInfo.description}</div>
                  <div style={{ ...styles.matchMeta, color: '#bc8cff' }}>{m.categoryInfo.dpdpa_section}</div>
                  <div style={styles.matchMeta}>Detected by: {m.matchedBy === 'column_name' ? 'Column name pattern' : 'Data value pattern'}</div>
                  {m.matchedTypes && m.matchedTypes.length > 0 && (
                    <div style={styles.matchMeta}>Matched: {m.matchedTypes.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* PII Category node */}
      {node.type === 'pii_category' && (
        <>
          <Field label="DPDPA Section" value={node.dpdpaSection || '—'} />
          <Field label="Description" value={node.description || '—'} />
        </>
      )}
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string | number | boolean; highlight?: boolean }) {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <span style={{ ...styles.fieldValue, color: highlight ? '#f85149' : '#e6edf3' }}>{String(value)}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 10,
    padding: 16, minWidth: 260, maxWidth: 300, maxHeight: '80vh', overflowY: 'auto',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid', letterSpacing: '0.5px' },
  closeBtn: { background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14, padding: '2px 4px' },
  nodeLabel: { fontSize: 16, fontWeight: 700, color: '#e6edf3', marginBottom: 10, wordBreak: 'break-all' },
  divider: { height: 1, background: '#30363d', margin: '8px 0' },
  field: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  fieldLabel: { fontSize: 12, color: '#8b949e', flexShrink: 0 },
  fieldValue: { fontSize: 12, fontWeight: 500, textAlign: 'right' },
  matchesSection: { marginTop: 10 },
  matchesTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  matchCard: {
    background: '#161b22', border: '1px solid #30363d', borderLeft: '3px solid',
    borderRadius: 6, padding: '8px 10px', marginBottom: 8,
  },
  matchHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  confBadge: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, border: '1px solid', marginLeft: 'auto' },
  matchMeta: { fontSize: 11, color: '#8b949e', marginTop: 2, lineHeight: 1.5 },
};
